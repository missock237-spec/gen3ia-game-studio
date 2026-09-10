'use client'
// Profiler — real-time engine stats (fps, draw calls, tris, physics/AI/script ms, network).
import { useEditor } from '@/stores/editor-store'
import { useEffect, useState } from 'react'

export default function ProfilerPanel() {
  const stats = useEditor((s) => s.stats)
  const rt = useEditor((s) => s.runtimeStats)
  const projectId = useEditor((s) => s.projectId)
  const [net, setNet] = useState<{ online: boolean; rooms: Array<{ key: string; players: number }>; totalPlayers: number; tickRate?: number } | null>(null)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch('/api/multiplayer')
        const data = await res.json()
        if (alive) setNet(data)
      } catch { /* offline */ }
    }
    void poll()
    const iv = setInterval(poll, 5000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  const rows: Array<[string, string]> = [
    ['FPS', String(stats?.fps ?? '—')],
    ['Draw calls', String(stats?.drawCalls ?? '—')],
    ['Triangles', stats?.triangles?.toLocaleString() ?? '—'],
    ['Géométries', String(stats?.geometries ?? '—')],
    ['Textures', String(stats?.textures ?? '—')],
    ['Physique (ms/frame)', rt ? String(rt.physicsMs) : '—'],
    ['IA PNJ (ms/frame)', rt ? String(rt.aiMs) : '—'],
    ['Scripts (ms/frame)', rt ? String(rt.scriptMs) : '—'],
    ['Entités actives', rt ? String(rt.entities) : '—'],
    ['Corps physiques', rt ? String(rt.bodies) : '—'],
  ]

  return (
    <div className="h-full overflow-y-auto p-3 text-xs">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded border border-gray-800 bg-gray-900/50 p-2">
            <div className="text-[9px] uppercase tracking-wider text-gray-500">{k}</div>
            <div className="font-mono text-sm text-gray-100">{v}</div>
          </div>
        ))}
        <div className="rounded border border-gray-800 bg-gray-900/50 p-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500">Multiplayer</div>
          <div className="font-mono text-sm text-gray-100">
            {net?.online ? `${net.totalPlayers} joueur(s)` : 'hors ligne'}
          </div>
          {net?.online && <div className="text-[9px] text-gray-500">tick {net.tickRate}Hz · {net.rooms?.length ?? 0} room(s)</div>}
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/50 p-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500">Projet</div>
          <div className="truncate font-mono text-sm text-gray-100">{projectId ? projectId.slice(0, 10) : '—'}</div>
        </div>
      </div>
    </div>
  )
}
