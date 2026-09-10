// GEN3IA — Multiplayer game server (server-authoritative, MMO-ready).
// Rooms/zones, 20Hz tick, spatial hash grid (AOI), heartbeat, reconnect via
// session tokens, entity replication (world.json), input rate limiting,
// speed validation (anti-cheat), metrics.
import { createServer } from 'http'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { Server, type Socket } from 'socket.io'
import { randomUUID } from 'crypto'

const PORT = Number(process.env.GAME_SERVER_PORT ?? 3003)
const STATS_PORT = Number(process.env.GAME_SERVER_STATS_PORT ?? 3103)
const TICK_RATE = 20
const TICK_MS = 1000 / TICK_RATE
const SNAPSHOT_HZ = 15
const HEARTBEAT_TIMEOUT = 12_000
const CELL_SIZE = 40 // spatial hash cell (interest grid)
const MAX_SPEED = 30 // units/s — server clamps faster movement
const MAX_INPUT_HZ = 30 // input rate limit (anti-spam)
const MAX_CHAT_PER_10S = 8
const SESSION_TTL_MS = 30 * 60_000 // sessions sans reconnexion → purge
const PERSIST_INTERVAL_MS = 60_000 // checkpoint positions (fichier si activé)
const PERSIST_FILE = process.env.GAME_SERVER_PERSIST_FILE ?? '' // ex: /data/positions.json

// Embedded world (dedicated-server artifact): world.json next to the bundle.
interface WorldEntity {
  name?: string
  components?: { transform?: { position?: { x?: number; y?: number; z?: number } } }
}
interface WorldFile { name?: string; scene?: { entities?: Record<string, WorldEntity> }; server?: { tickRate?: number; snapshotHz?: number; maxSpeed?: number; interestRadius?: number; regions?: Array<{ name?: string; zones: string[] }> } }
let WORLD: WorldFile | null = null
const WORLD_PATHS = ['world.json', path_cwd() + '/world.json']
function path_cwd(): string { try { return process.cwd() } catch { return '.' } }
for (const p of WORLD_PATHS) {
  try {
    if (p && existsSync(p)) { WORLD = JSON.parse(readFileSync(p, 'utf8')); console.log(`world chargé: ${p}`); break }
  } catch { /* ignore */ }
}
const TICK_EFF = WORLD?.server?.tickRate ?? TICK_RATE
const SNAP_EFF = WORLD?.server?.snapshotHz ?? SNAPSHOT_HZ
const SPEED_EFF = WORLD?.server?.maxSpeed ?? MAX_SPEED
// AOI configurable : radius réel au-delà du filtre de grille (0 = grille seule)
const INTEREST_RADIUS = WORLD?.server?.interestRadius ?? 0
// Régions MMO : regroupement logique de zones (World → Region → Zone).
// Défini dans world.json (server.regions) sinon une région par défaut par monde.
interface RegionConfig { name: string; zones: Set<string> }
const REGIONS: RegionConfig[] = (WORLD?.server?.regions ?? [])
  .map((r) => ({ name: r.name ?? r.zones[0] ?? 'region-0', zones: new Set(r.zones) }))

function regionOfZone(zone: string): string {
  for (const r of REGIONS) if (r.zones.has(zone)) return r.name
  return REGIONS[0]?.name ?? 'region-default'
}

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
  inputCount: number
  cell: { cx: number; cz: number }
}

interface Room {
  key: string // projectId:zone
  projectId: string
  zone: string
  players: Map<string, PlayerState>
  grid: Map<string, Set<string>> // "cx,cz" -> playerIds
  staticEntities: unknown[] // replicated scene entities (from world.json)
  createdAt: number
  msgCount: number
  rejectedInputs: number
}

const rooms = new Map<string, Room>()
const sessions = new Map<string, PlayerState>() // sessionToken -> player (reconnect)
const startedAt = Date.now()
let totalConnections = 0
let totalRejected = 0

function cellOf(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CELL_SIZE), cz: Math.floor(z / CELL_SIZE) }
}

function gridInsert(room: Room, p: PlayerState) {
  const { cx, cz } = cellOf(p.x, p.z)
  p.cell = { cx, cz }
  const k = `${cx},${cz}`
  let set = room.grid.get(k)
  if (!set) { set = new Set(); room.grid.set(k, set) }
  set.add(p.id)
}

function gridMove(room: Room, p: PlayerState, x: number, z: number) {
  const next = cellOf(x, z)
  if (next.cx !== p.cell.cx || next.cz !== p.cell.cz) {
    const prev = room.grid.get(`${p.cell.cx},${p.cell.cz}`)
    prev?.delete(p.id)
    p.cell = next
    const k = `${next.cx},${next.cz}`
    let set = room.grid.get(k)
    if (!set) { set = new Set(); room.grid.set(k, set) }
    set.add(p.id)
  }
  // la position doit TOUJOURS être persistée (bug historique: x figé
  // dans une même cellule → désynchronisation client/serveur)
  p.x = x
  p.z = z
}

/** AOI: players in the 3x3 cells around p (spatial partitioning),
 *  filtrés par distance réelle si INTEREST_RADIUS est configuré (world.json). */
function neighbors(room: Room, p: PlayerState): PlayerState[] {
  const out: PlayerState[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const set = room.grid.get(`${p.cell.cx + dx},${p.cell.cz + dz}`)
      if (!set) continue
      for (const id of set) {
        if (id === p.id) continue
        const o = room.players.get(id)
        if (!o) continue
        if (INTEREST_RADIUS > 0) {
          const d = Math.hypot(o.x - p.x, o.z - p.z)
          if (d > INTEREST_RADIUS) continue
        }
        out.push(o)
      }
    }
  }
  return out
}

function getRoom(projectId: string, zone: string): Room {
  const key = `${projectId}:${zone}`
  let room = rooms.get(key)
  if (!room) {
    room = { key, projectId, zone, players: new Map(), grid: new Map(), staticEntities: [], createdAt: Date.now(), msgCount: 0, rejectedInputs: 0 }
    // replicate world entities once per room (dedicated server artifact)
    const worldScene = (WORLD as { scene?: { entities?: Record<string, WorldEntity> } } | null)?.scene
    if (worldScene?.entities) {
      room.staticEntities = Object.values(worldScene.entities).slice(0, 500).map((e) => ({
        name: e.name ?? 'entity',
        position: e.components?.transform?.position ?? { x: 0, y: 0, z: 0 },
      }))
    }
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

// stats server interne (server-to-server) — métriques complètes
const statsServer = createServer((req, res) => {
  if (req.url === '/stats' || req.url === '/metrics') {
    const roomsInfo = [...rooms.values()].map((r) => ({
      key: r.key,
      projectId: r.projectId,
      zone: r.zone,
      region: regionOfZone(r.zone),
      players: r.players.size,
      gridCells: r.grid.size,
      staticEntities: r.staticEntities.length,
      msgPerSec: r.msgCount,
      rejectedInputs: r.rejectedInputs,
    }))
    const regionsInfo = [...new Set([...rooms.values()].map((r) => regionOfZone(r.zone)))].map((rn) => ({
      name: rn,
      zones: REGIONS.find((r) => r.name === rn)?.zones.size ?? 1,
      players: roomsInfo.filter((r) => r.region === rn).reduce((n, r) => n + r.players, 0),
    }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      tickRate: TICK_EFF,
      realTickHz: Math.round(realTickHz * 10) / 10,
      snapshotHz: SNAP_EFF,
      maxSpeed: SPEED_EFF,
      rooms: roomsInfo,
      regions: regionsInfo,
      interestRadius: INTEREST_RADIUS,
      totalPlayers: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
      totalConnections,
      totalRejectedInputs: totalRejected,
      sessionsTracked: sessions.size,
      worldLoaded: Boolean(WORLD),
      mem: process.memoryUsage().rss,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    }))
    return
  }
  res.writeHead(404)
  res.end()
})
statsServer.listen(STATS_PORT, () => console.log(`stats server on :${STATS_PORT}`))

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20_000,
  pingInterval: 10_000,
})

io.on('connection', (socket: Socket) => {
  totalConnections += 1
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
    gridInsert(room, player)
    joined = { room, player }
    void socket.join(room.key)

    socket.emit('joined', {
      you: player,
      roomKey: room.key,
      worldName: WORLD?.name ?? null,
      tickRate: TICK_EFF,
      snapshotHz: SNAP_EFF,
      entities: room.staticEntities,
      players: [...room.players.values()].filter((p) => p.id !== player!.id),
    })
    socket.to(room.key).emit('player-joined', { player })
    ack?.({ ok: true, playerId: player.id, sessionToken: player.sessionToken })
  })

  // client input (rate-limited) — server validates speed then becomes authoritative
  socket.on('state', (data: { x?: number; y?: number; z?: number; rx?: number; ry?: number; anim?: string }) => {
    if (!joined) return
    const { player, room } = joined
    const now = Date.now()
    // anti-spam: input rate limit (MAX_INPUT_HZ with 1.5x burst tolerance)
    const dtRaw = (now - player.lastInput) / 1000
    if (dtRaw > 0 && dtRaw < 1 / (MAX_INPUT_HZ * 1.5)) {
      room.rejectedInputs += 1
      totalRejected += 1
      return
    }
    const dtSec = Math.max(0.016, dtRaw)
    player.lastInput = now

    if (typeof data.x === 'number' && typeof data.z === 'number') {
      const dx = data.x - player.x
      const dz = data.z - player.z
      const dist = Math.hypot(dx, dz)
      const maxDist = SPEED_EFF * dtSec * 1.5 // tolerance
      if (dist > maxDist && dist > 0.001) {
        // clamp: reject teleport-like movement (server authority)
        const scale = maxDist / dist
        const nx = player.x + dx * scale
        const nz = player.z + dz * scale
        gridMove(room, player, nx, nz)
      } else {
        gridMove(room, player, data.x, data.z)
      }
    }
    if (typeof data.y === 'number' && Number.isFinite(data.y)) player.y = data.y
    if (typeof data.ry === 'number' && Number.isFinite(data.ry)) player.ry = data.ry
    if (typeof data.rx === 'number' && Number.isFinite(data.rx)) player.rx = data.rx
    if (typeof data.anim === 'string') player.anim = sanitize(data.anim, 16, 'idle')
    room.msgCount += 1
  })

  socket.on('chat', (data: { text?: string }) => {
    if (!joined) return
    const now = Date.now()
    const p = joined.player as PlayerState & { chatTimes?: number[] }
    p.chatTimes = (p.chatTimes ?? []).filter((t) => now - t < 10_000)
    if (p.chatTimes.length >= MAX_CHAT_PER_10S) return
    p.chatTimes.push(now)
    const text = sanitize(data.text, 200, '')
    if (!text) return
    io.to(joined.room.key).emit('chat', {
      from: joined.player.name,
      color: joined.player.color,
      text,
      at: now,
    })
  })

  socket.on('heartbeat', () => {
    if (joined) joined.player.lastSeen = Date.now()
  })

  // Zone handoff (MMO) : migration d'un joueur vers une autre zone de la même
  // région/world en préservant son état (position, session, couleur).
  socket.on('zone:move', (data: { zone?: string }, ack?: (resp: unknown) => void) => {
    if (!joined) return ack?.({ ok: false, error: 'not-joined' })
    const target = sanitize(data.zone, 32, '')
    if (!target) return ack?.({ ok: false, error: 'zone requise' })
    const { room, player } = joined
    if (target === room.zone) return ack?.({ ok: true, zone: room.zone, moved: false })
    const targetRoom = getRoom(room.projectId, target)
    // sortie propre de l'ancienne zone
    room.players.delete(player.id)
    room.grid.get(`${player.cell.cx},${player.cell.cz}`)?.delete(player.id)
    void socket.leave(room.key)
    socket.to(room.key).emit('player-left', { playerId: player.id, reason: 'zone-handoff' })
    // entrée dans la nouvelle zone (état conservé)
    targetRoom.players.set(player.id, player)
    gridInsert(targetRoom, player)
    void socket.join(targetRoom.key)
    joined = { room: targetRoom, player }
    socket.emit('zone-changed', {
      zone: targetRoom.zone,
      region: regionOfZone(targetRoom.zone),
      entities: targetRoom.staticEntities,
      players: [...targetRoom.players.values()].filter((p) => p.id !== player.id),
    })
    socket.to(targetRoom.key).emit('player-joined', { player })
    ack?.({ ok: true, zone: targetRoom.zone, region: regionOfZone(targetRoom.zone) })
  })

  socket.on('disconnect', () => {
    if (!joined) return
    const { room, player } = joined
    // keep the session for reconnect (sessions map), remove from live room
    room.players.delete(player.id)
    room.grid.get(`${player.cell.cx},${player.cell.cz}`)?.delete(player.id)
    socket.to(room.key).emit('player-left', { playerId: player.id })
    if (room.players.size === 0) {
      setTimeout(() => {
        if (rooms.get(room.key)?.players.size === 0) rooms.delete(room.key)
      }, 30_000)
    }
  })
})

// ─────────────────── tick loop: authoritative snapshots (spatial grid) ───────────────────
let snapshotTimer = 0
let lastTickAt = Date.now()
let realTickHz = TICK_EFF
setInterval(() => {
  const now = Date.now()
  // mesure du tick rate réel (métrique)
  const elapsed = now - lastTickAt
  if (elapsed > 0) realTickHz = realTickHz * 0.95 + (1000 / elapsed) * 0.05
  lastTickAt = now

  // heartbeat timeout — drop silent players
  for (const room of rooms.values()) {
    for (const [id, p] of room.players) {
      if (now - p.lastSeen > HEARTBEAT_TIMEOUT) {
        room.players.delete(id)
        room.grid.get(`${p.cell.cx},${p.cell.cz}`)?.delete(id)
        io.to(room.key).emit('player-left', { playerId: id, reason: 'timeout' })
      }
    }
  }

  snapshotTimer += TICK_MS
  if (snapshotTimer >= 1000 / SNAP_EFF) {
    snapshotTimer = 0
    for (const room of rooms.values()) {
      const all = [...room.players.values()]
      if (all.length === 0) continue
      for (const p of all) {
        const socket = p.socketId ? io.sockets.sockets.get(p.socketId) : null
        if (!socket) continue
        // interest management via spatial hash grid (3x3 cellules + radius AOI)
        const visible = neighbors(room, p)
        socket.emit('snapshot', {
          t: now,
          zone: room.zone,
          region: regionOfZone(room.zone),
          players: visible.map((o) => ({ id: o.id, name: o.name, color: o.color, x: o.x, y: o.y, z: o.z, ry: o.ry, anim: o.anim })),
        })
      }
    }
  }
}, TICK_MS)

// ─────────── purge des sessions expirées + checkpoint positions ───────────
setInterval(() => {
  const now = Date.now()
  for (const [token, p] of sessions) {
    if (now - p.lastSeen > SESSION_TTL_MS) sessions.delete(token)
  }
  if (PERSIST_FILE) {
    try {
      const data: Record<string, { x: number; y: number; z: number; zone: string }> = {}
      for (const room of rooms.values()) {
        for (const p of room.players.values()) data[p.id] = { x: p.x, y: p.y, z: p.z, zone: room.zone }
      }
      writeFileSync(PERSIST_FILE, JSON.stringify({ at: new Date().toISOString(), players: data }))
    } catch (e) { console.error('persist échec:', e instanceof Error ? e.message : e) }
  }
}, PERSIST_INTERVAL_MS)

httpServer.listen(PORT, () => {
  console.log(`GEN3IA multiplayer game server on :${PORT} (tick ${TICK_EFF}Hz, world: ${WORLD ? 'chargé' : 'aucun'})`)
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
