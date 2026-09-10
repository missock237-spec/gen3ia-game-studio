'use client'
// Build dialog — real Build Orchestrator: start builds, live status, download artifact.
import { useEffect, useRef, useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Download, Hammer, Loader2, Package } from 'lucide-react'

interface BuildRow {
  id: string
  target: string
  status: string
  progress: number
  logs: string
  artifactUrl: string | null
  artifactSize: number | null
  error: string | null
  createdAt: string
}

const STATUS_COLOR: Record<string, string> = {
  QUEUED: 'text-gray-400', VALIDATING: 'text-sky-400', BUILDING: 'text-amber-400',
  TESTING: 'text-purple-400', PACKAGING: 'text-cyan-400', UPLOADING: 'text-blue-400',
  COMPLETED: 'text-green-400', FAILED: 'text-red-400', CANCELLED: 'text-gray-500',
}

export default function BuildDialog() {
  const projectId = useEditor((s) => s.projectId)
  const addLog = useEditor((s) => s.addLog)
  const [open, setOpen] = useState(false)
  const [builds, setBuilds] = useState<BuildRow[]>([])
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = async () => {
    if (!projectId) return
    const res = await fetch(`/api/projects/${projectId}/builds`)
    if (res.ok) setBuilds((await res.json()).builds)
  }

  useEffect(() => {
    if (!open) return
    void refresh()
    pollRef.current = setInterval(() => void refresh(), 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
     
  }, [open, projectId])

  const start = async (target: 'web' | 'github') => {
    if (!projectId) return
    setStarting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const data = await res.json()
      if (!res.ok) {
        addLog('error', `Build: ${data.error?.message ?? res.status}`)
      } else {
        addLog('info', `Build ${data.build.id.slice(0, 8)} lancé (cible ${target})`)
        await refresh()
      }
    } finally {
      setStarting(false)
    }
  }

  const parseLogs = (raw: string): Array<{ t: string; level: string; msg: string }> => {
    try { return JSON.parse(raw) } catch { return [] }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-gray-300 hover:text-white">
          <Package className="mr-1 h-4 w-4" /> Builds
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="h-4 w-4" /> Build Orchestrator
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Button size="sm" className="bg-green-600 hover:bg-green-500" disabled={starting} onClick={() => void start('web')}>
            {starting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Package className="mr-1 h-3.5 w-3.5" />}
            Build Web (export jouable)
          </Button>
          <Button size="sm" variant="secondary" disabled={starting} onClick={() => void start('github')}>
            Build via GitHub Actions
          </Button>
        </div>
        <p className="text-[10px] text-gray-500">
          Pipeline réel: VALIDATING → BUILDING (esbuild) → TESTING → PACKAGING → UPLOADING → COMPLETED.
          Le build web produit un fichier HTML autonome jouable hors ligne. « GitHub Actions » déclenche le workflow build-web.yml du dépôt connecté.
        </p>

        <ScrollArea className="max-h-[45vh]">
          <div className="space-y-3">
            {builds.length === 0 && <p className="text-xs text-gray-500">Aucun build. Lancez-en un ↑</p>}
            {builds.map((b) => (
              <div key={b.id} className="rounded border border-gray-800 p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-gray-400">{b.id.slice(0, 8)}</span>
                  <Badge variant="outline" className="text-[9px]">{b.target}</Badge>
                  <span className={`font-bold uppercase ${STATUS_COLOR[b.status] ?? ''}`}>{b.status}</span>
                  {b.artifactSize && <span className="text-[10px] text-gray-500">{(b.artifactSize / 1024 / 1024).toFixed(1)} Mo</span>}
                  <span className="ml-auto text-[10px] text-gray-600">{new Date(b.createdAt).toLocaleString()}</span>
                  {b.status === 'COMPLETED' && b.artifactUrl && projectId && (
                    <a href={`/api/builds/${b.id}/artifact`} download>
                      <Button size="sm" className="h-6 bg-green-600 text-[10px] hover:bg-green-500">
                        <Download className="mr-1 h-3 w-3" /> Télécharger le jeu
                      </Button>
                    </a>
                  )}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-800">
                  <div
                    className={`h-full transition-all ${b.status === 'FAILED' ? 'bg-red-500' : 'bg-green-500'}`}
                    style={{ width: `${b.progress}%` }}
                  />
                </div>
                <div className="mt-1 max-h-28 overflow-y-auto rounded bg-gray-950 p-1.5 font-mono text-[10px] leading-4">
                  {parseLogs(b.logs).map((l, i) => (
                    <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-gray-400'}>
                      [{new Date(l.t).toLocaleTimeString()}] {l.msg}
                    </div>
                  ))}
                  {b.error && <div className="text-red-400">ERREUR: {b.error}</div>}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
