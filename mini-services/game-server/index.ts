// GEN3IA — Multiplayer game server (server-authoritative).
// Rooms, 20Hz tick, presence, heartbeat, reconnect via session tokens,
// interest management (distance culling), speed validation (anti-cheat).
import { createServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { randomUUID } from 'crypto'

const PORT = 3003
const TICK_RATE = 20
const TICK_MS = 1000 / TICK_RATE
const SNAPSHOT_HZ = 15
const HEARTBEAT_TIMEOUT = 12_000
const INTEREST_RADIUS = 80
const MAX_SPEED = 30 // units/s — server rejects faster movement

interface PlayerState {
  id: string
  sessionToken: string
  socketId: string | null
  name: string
  color: string
  x: number; y: number; z: number
  rx: number; ry: number
  anim: string
  lastSeen: number
  lastInput: number
}

interface Room {
  key: string // projectId:zone
  projectId: string
  zone: string
  players: Map<string, PlayerState>
  createdAt: number
}

const rooms = new Map<string, Room>()
const sessions = new Map<string, PlayerState>() // sessionToken -> player (reconnect support)
const startedAt = Date.now()

function getRoom(projectId: string, zone: string): Room {
  const key = `${projectId}:${zone}`
  let room = rooms.get(key)
  if (!room) {
    room = { key, projectId, zone, players: new Map(), createdAt: Date.now() }
    rooms.set(key, room)
  }
  return room
}

function sanitize(str: unknown, max: number, fallback: string): string {
  if (typeof str !== 'string' || !str.trim()) return fallback
  return str.replace(/[^\w \-'.!?àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/g, '').slice(0, max)
}

function colorFor(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h}, 70%, 55%)`
}

const httpServer = createServer(() => {
  // all requests are handled by socket.io (path '/')
})

// internal stats server (server-to-server only, not exposed by the gateway)
const statsServer = createServer((req, res) => {
  if (req.url === '/stats') {
    const roomsInfo = [...rooms.values()].map((r) => ({
      key: r.key,
      projectId: r.projectId,
      zone: r.zone,
      players: r.players.size,
    }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      tickRate: TICK_RATE,
      rooms: roomsInfo,
      totalPlayers: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    }))
    return
  }
  res.writeHead(404)
  res.end()
})
statsServer.listen(3103, () => console.log('stats server on :3103'))

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20_000,
  pingInterval: 10_000,
})

io.on('connection', (socket: Socket) => {
  let joined: { room: Room; player: PlayerState } | null = null

  socket.on('join', (data: {
    projectId?: string; zone?: string; name?: string; color?: string
    sessionToken?: string; pos?: { x: number; y: number; z: number }
  }, ack?: (resp: unknown) => void) => {
    const projectId = sanitize(data.projectId, 64, 'default')
    const zone = sanitize(data.zone, 32, 'zone-A')
    const room = getRoom(projectId, zone)

    let player: PlayerState | undefined
    // reconnect recovery
    if (data.sessionToken && sessions.has(data.sessionToken)) {
      const prior = sessions.get(data.sessionToken)!
      if (prior.socketId && prior.socketId !== socket.id) {
        io.sockets.sockets.get(prior.socketId)?.leave(room.key)
      }
      prior.socketId = socket.id
      prior.lastSeen = Date.now()
      if (data.pos) { prior.x = data.pos.x; prior.y = data.pos.y; prior.z = data.pos.z }
      player = prior
    }

    if (!player) {
      player = {
        id: randomUUID().slice(0, 8),
        sessionToken: randomUUID(),
        socketId: socket.id,
        name: sanitize(data.name, 24, `Joueur-${Math.floor(Math.random() * 999)}`),
        color: typeof data.color === 'string' && /^hsl\(\d+, \d+%, \d+%\)$/.test(data.color) ? data.color : colorFor(randomUUID()),
        x: data.pos?.x ?? 0, y: data.pos?.y ?? 1, z: data.pos?.z ?? 0,
        rx: 0, ry: 0,
        anim: 'idle',
        lastSeen: Date.now(),
        lastInput: Date.now(),
      }
      sessions.set(player.sessionToken, player)
    }

    room.players.set(player.id, player)
    joined = { room, player }
    void socket.join(room.key)

    socket.emit('joined', {
      you: player,
      roomKey: room.key,
      tickRate: TICK_RATE,
      players: [...room.players.values()].filter((p) => p.id !== player!.id),
    })
    socket.to(room.key).emit('player-joined', { player })
    ack?.({ ok: true, playerId: player.id, sessionToken: player.sessionToken })
  })

  // client input (15Hz max client-side) — server validates speed then becomes authoritative
  socket.on('state', (data: { x?: number; y?: number; z?: number; rx?: number; ry?: number; anim?: string }) => {
    if (!joined) return
    const { player } = joined
    const now = Date.now()
    const dtSec = Math.max(0.016, (now - player.lastInput) / 1000)
    player.lastInput = now

    if (typeof data.x === 'number' && typeof data.z === 'number') {
      const dx = data.x - player.x
      const dz = data.z - player.z
      const dist = Math.hypot(dx, dz)
      const maxDist = MAX_SPEED * dtSec * 1.5 // tolerance
      if (dist > maxDist && dist > 0.001) {
        // clamp: reject teleport-like movement (server authority)
        const scale = maxDist / dist
        player.x += dx * scale
        player.z += dz * scale
      } else {
        player.x = data.x
        player.z = data.z
      }
    }
    if (typeof data.y === 'number' && Number.isFinite(data.y)) player.y = data.y
    if (typeof data.ry === 'number' && Number.isFinite(data.ry)) player.ry = data.ry
    if (typeof data.rx === 'number' && Number.isFinite(data.rx)) player.rx = data.rx
    if (typeof data.anim === 'string') player.anim = sanitize(data.anim, 16, 'idle')
  })

  socket.on('chat', (data: { text?: string }) => {
    if (!joined) return
    const text = sanitize(data.text, 200, '')
    if (!text) return
    io.to(joined.room.key).emit('chat', {
      from: joined.player.name,
      color: joined.player.color,
      text,
      at: Date.now(),
    })
  })

  socket.on('heartbeat', () => {
    if (joined) joined.player.lastSeen = Date.now()
  })

  socket.on('disconnect', () => {
    if (!joined) return
    const { room, player } = joined
    // keep the session for reconnect (sessions map), remove from live room
    room.players.delete(player.id)
    socket.to(room.key).emit('player-left', { playerId: player.id })
    if (room.players.size === 0) {
      setTimeout(() => {
        if (rooms.get(room.key)?.players.size === 0) rooms.delete(room.key)
      }, 30_000)
    }
  })
})

// ─────────────────── tick loop: authoritative snapshots ───────────────────
let snapshotTimer = 0
setInterval(() => {
  const now = Date.now()

  // heartbeat timeout — drop silent players
  for (const room of rooms.values()) {
    for (const [id, p] of room.players) {
      if (now - p.lastSeen > HEARTBEAT_TIMEOUT) {
        room.players.delete(id)
        io.to(room.key).emit('player-left', { playerId: id, reason: 'timeout' })
      }
    }
  }

  snapshotTimer += TICK_MS
  if (snapshotTimer >= 1000 / SNAPSHOT_HZ) {
    snapshotTimer = 0
    for (const room of rooms.values()) {
      const all = [...room.players.values()]
      if (all.length === 0) continue
      for (const p of all) {
        const socket = p.socketId ? io.sockets.sockets.get(p.socketId) : null
        if (!socket) continue
        // interest management: only players within radius
        const visible = all.filter(
          (o) => o.id !== p.id &&
            (Math.abs(o.x - p.x) + Math.abs(o.z - p.z)) < INTEREST_RADIUS,
        )
        socket.emit('snapshot', {
          t: now,
          players: visible.map((o) => ({ id: o.id, name: o.name, color: o.color, x: o.x, y: o.y, z: o.z, ry: o.ry, anim: o.anim })),
        })
      }
    }
  }
}, TICK_MS)

httpServer.listen(PORT, () => {
  console.log(`GEN3IA multiplayer game server on :${PORT} (tick ${TICK_RATE}Hz)`)
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
