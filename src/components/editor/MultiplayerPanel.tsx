'use client'
// Multiplayer panel — real WebSocket connection to the game server.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { io, type Socket } from 'socket.io-client'
import { useEditor } from '@/stores/editor-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Play, Users, Wifi, WifiOff } from 'lucide-react'

interface RemotePlayer {
  id: string
  name: string
  color: string
  x: number; y: number; z: number
  ry: number
  targetX: number; targetZ: number // interpolation
  mesh: THREE.Mesh
  lastUpdate: number
}

interface ChatLine { from: string; color: string; text: string; at: number }

export default function MultiplayerPanel() {
  const projectId = useEditor((s) => s.projectId)
  const [connected, setConnected] = useState(false)
  const [joined, setJoined] = useState(false)
  const [name, setName] = useState('')
  const [players, setPlayers] = useState<Array<{ id: string; name: string; color: string }>>([])
  const [chat, setChat] = useState<ChatLine[]>([])
  const [chatInput, setChatInput] = useState('')
  const [ping, setPing] = useState<number | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const remoteRef = useRef<Map<string, RemotePlayer>>(new Map())
  const sendTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const hbTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // hook the runtime's renderer scene to spawn remote player avatars
  const attachAvatar = (id: string, name: string, color: string): RemotePlayer['mesh'] => {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.9, 6, 16),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.3, roughness: 0.5 }),
    )
    mesh.name = `mp_${id}`
    mesh.userData.remotePlayerId = id
    return mesh
  }

  const getScene = (): THREE.Scene | null => {
    // the renderer instance lives on the viewport; access via global ref set by shell
    return (window as unknown as { __GEN3IA_SCENE__?: THREE.Scene }).__GEN3IA_SCENE__ ?? null
  }

  const join = () => {
    if (socketRef.current) return
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      timeout: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      const sessionToken = sessionStorage.getItem('gen3ia_mp_token') ?? undefined
      const playerColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`
      socket.emit('join', {
        projectId: projectId ?? 'default',
        zone: 'zone-A',
        name: name || useEditor.getState().user?.name || 'Joueur',
        color: playerColor,
        sessionToken,
        pos: { x: 0, y: 1, z: 0 },
      }, (resp: { ok: boolean; sessionToken?: string }) => {
        if (resp?.ok && resp.sessionToken) {
          sessionStorage.setItem('gen3ia_mp_token', resp.sessionToken)
          setJoined(true)
        }
      })
    })

    socket.on('disconnect', () => { setConnected(false); setJoined(false) })

    socket.on('joined', (data: { players: Array<{ id: string; name: string; color: string }> }) => {
      setPlayers(data.players.map((p) => ({ id: p.id, name: p.name, color: p.color })))
    })

    socket.on('player-joined', (data: { player: { id: string; name: string; color: string } }) => {
      setPlayers((ps) => [...ps.filter((p) => p.id !== data.player.id), data.player])
    })

    socket.on('player-left', (data: { playerId: string }) => {
      setPlayers((ps) => ps.filter((p) => p.id !== data.playerId))
      removeRemote(data.playerId)
    })

    // authoritative snapshots → interpolate remote avatars
    socket.on('snapshot', (data: { players: Array<{ id: string; name: string; color: string; x: number; y: number; z: number; ry: number }> }) => {
      const scene = getScene()
      for (const p of data.players) {
        let remote = remoteRef.current.get(p.id)
        if (!remote && scene) {
          const mesh = attachAvatar(p.id, p.name, p.color)
          mesh.position.set(p.x, p.y, p.z)
          scene.add(mesh)
          remote = { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, ry: p.ry, targetX: p.x, targetZ: p.z, mesh, lastUpdate: Date.now() }
          remoteRef.current.set(p.id, remote)
          setPlayers((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, { id: p.id, name: p.name, color: p.color }]))
        }
        if (remote) {
          remote.targetX = p.x
          remote.targetZ = p.z
          remote.y = p.y
          remote.ry = p.ry
          remote.lastUpdate = Date.now()
        }
      }
    })

    socket.on('chat', (line: ChatLine) => {
      setChat((c) => [...c.slice(-50), line])
    })

    // send own position 10Hz (server validates & broadcasts 15Hz)
    sendTimer.current = setInterval(() => {
      const scene = getScene()
      const cam = (window as unknown as { __GEN3IA_CAMERA__?: THREE.PerspectiveCamera }).__GEN3IA_CAMERA__
      if (!cam) return
      // the local player is the camera position when playing; otherwise scene origin
      const pos = scene ? cam.position : { x: 0, y: 1, z: 0 }
      socket.emit('state', { x: pos.x, y: pos.y, z: pos.z, ry: Math.atan2(-cam.getWorldDirection(new THREE.Vector3()).x, -cam.getWorldDirection(new THREE.Vector3()).z), anim: 'idle' })
    }, 100)

    hbTimer.current = setInterval(() => socket.emit('heartbeat'), 5000)
    const pingIv = setInterval(() => {
      const t0 = performance.now()
      socket.emit('heartbeat')
      socket.io.engine.once('ping', () => setPing(Math.round(performance.now() - t0)))
    }, 3000)
    void pingIv
  }

  const removeRemote = (id: string) => {
    const remote = remoteRef.current.get(id)
    if (remote) {
      remote.mesh.removeFromParent()
      remote.mesh.geometry.dispose()
      ;(remote.mesh.material as THREE.Material).dispose()
      remoteRef.current.delete(id)
    }
  }

  // interpolation loop
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = Date.now()
      for (const remote of remoteRef.current.values()) {
        remote.x += (remote.targetX - remote.x) * 0.18
        remote.z += (remote.targetZ - remote.z) * 0.18
        remote.mesh.position.set(remote.x, remote.y, remote.z)
        remote.mesh.rotation.y = remote.ry
        void now
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // cleanup on unmount
  useEffect(() => () => {
    if (sendTimer.current) clearInterval(sendTimer.current)
    if (hbTimer.current) clearInterval(hbTimer.current)
    socketRef.current?.disconnect()
    for (const id of [...remoteRef.current.keys()]) removeRemote(id)
  }, [])

  const sendChat = () => {
    if (!chatInput.trim()) return
    socketRef.current?.emit('chat', { text: chatInput })
    setChatInput('')
  }

  return (
    <div className="flex h-full flex-col p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        {connected ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4 text-red-400" />}
        <span className="text-gray-300">{connected ? 'Serveur de jeu connecté (tick 20Hz)' : 'Non connecté'}</span>
        {ping !== null && <Badge variant="outline" className="text-[9px]">{ping} ms</Badge>}
      </div>

      {!joined ? (
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre pseudo" className="h-8" />
          <Button size="sm" className="w-full" onClick={join} disabled={!connected && !name}>
            <Play className="mr-1 h-3.5 w-3.5" /> Rejoindre zone A
          </Button>
          <p className="text-[10px] text-gray-500">
            Le serveur est autoritaire : positions validées (anti-téléport), snapshots 15Hz, reconnexion par session token.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-gray-400">
            <Users className="h-3.5 w-3.5" /> {players.length + 1} joueur(s) dans la zone
          </div>
          <ScrollArea className="max-h-32 flex-1">
            <div className="space-y-1">
              {players.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded bg-gray-900 px-2 py-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                  <span className="text-gray-200">{p.name}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded bg-gray-950 p-2 font-mono text-[10px]">
            {chat.map((c, i) => (
              <div key={i}><span style={{ color: c.color }}>{c.from}:</span> <span className="text-gray-300">{c.text}</span></div>
            ))}
          </div>
          <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); void sendChat() }}>
            <Input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message…" className="h-7 text-[11px]" />
            <Button type="submit" size="sm" variant="secondary" className="h-7">Envoyer</Button>
          </form>
        </>
      )}
    </div>
  )
}
