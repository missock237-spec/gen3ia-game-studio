'use client'
// Build dialog — real Build Orchestrator UI: multi-target, live logs, cancel,
// artifacts with checksum/size, provider badges (local / GitHub Actions / Cloud Build).
import { useEffect, useRef, useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Download, Hammer, Loader2, Package, XCircle, CheckCircle2, Globe, Server, Smartphone, Monitor, Terminal } from 'lucide-react'

interface ArtifactRow {
  id: string
  fileName: string
  kind: string
  size: number
  checksum: string
  version: string
  status: string
  provider: string
}

interface BuildRow {
  id: string
  target: string
  version: string
  provider: string
  profile: string
  status: string
  progress: number
  logs: string
  artifactUrl: string | null
  artifactSize: number | null
  error: string | null
  externalUrl: string | null
  artifacts: ArtifactRow[]
  createdAt: string
}

const STATUS_COLOR: Record<string, string> = {
  QUEUED: 'text-gray-400', PREPARING: 'text-sky-400', BUILDING: 'text-amber-400',
  TESTING: 'text-purple-400', PACKAGING: 'text-cyan-400', UPLOADING: 'text-blue-400',
  COMPLETED: 'text-green-400', FAILED: 'text-red-400', CANCELLED: 'text-gray-500',
}

const TARGETS = [
  { value: 'web', label: 'Web (HTML autonome)', icon: Globe, hint: 'local — toujours disponible' },
  { value: 'dedicated-server', label: 'Serveur dédié (zip Node)', icon: Server, hint: 'local — toujours disponible' },
  { value: 'android', label: 'Android (APK)', icon: Smartphone, hint: 'cloud — GitHub Actions ou Cloud Build' },
  { value: 'windows', label: 'Windows', icon: Monitor, hint: 'cloud — runner Windows requis' },
  { value: 'linux', label: 'Linux', icon: Terminal, hint: 'cloud — GitHub Actions ou Cloud Build' },
] as const

export default function BuildDialog() {
  const projectId = useEditor((s) => s.projectId)
  const addLog = useEditor((s) => s.addLog)
  const [open, setOpen] = useState(false)
  const [builds, setBuilds] = useState<BuildRow[]>([])
  const [starting, setStarting] = useState(false)
  const [target, setTarget] = useState<string>('web')
  const [version, setVersion] = useState('1.0.0')
  const [profile, setProfile] = useState<'development' | 'release'>('release')
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

  const start = async () => {
    if (!projectId) return
    setStarting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, version, profile: profile === 'development' ? 'debug' : 'release' }),
      })
      const data = await res.json()
      if (!res.ok) {
        addLog('error', `Build: ${data.error?.message ?? res.status}`)
      } else {
        addLog('info', `Build ${data.build.id.slice(0, 8)} lancé (${target} v${version})`)
        await refresh()
      }
    } finally {
      setStarting(false)
    }
  }

  const cancel = async (buildId: string) => {
    await fetch(`/api/builds/${buildId}/cancel`, { method: 'POST' })
    await refresh()
  }

  const parseLogs = (raw: string): Array<{ t: string; level: string; msg: string }> => {
    try { return JSON.parse(raw) } catch { return [] }
  }

  const hasActive = builds.some((b) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(b.status))

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

        {/* ── formulaire de lancement ── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="col-span-2 text-[10px] text-gray-400">
            Target
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-0.5 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200"
            >
              {TARGETS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-gray-400">
            Version
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
              className="mt-0.5 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-200"
            />
          </label>
          <label className="text-[10px] text-gray-400">
            Configuration
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value as 'development' | 'release')}
              className="mt-0.5 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200"
            >
              <option value="development">Development</option>
              <option value="release">Release</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="bg-green-600 hover:bg-green-500" disabled={starting || hasActive || !/^\d+\.\d+\.\d+$/.test(version)} onClick={() => void start()}>
            {starting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Package className="mr-1 h-3.5 w-3.5" />}
            BUILD
          </Button>
          <span className="text-[10px] text-gray-500">
            {TARGETS.find((t) => t.value === target)?.hint}
          </span>
        </div>

        <ScrollArea className="max-h-[48vh]">
          <div className="space-y-3">
            {builds.length === 0 && <p className="text-xs text-gray-500">Aucun build. Lancez-en un ↑</p>}
            {builds.map((b) => {
              const primary = b.artifacts?.find((a) => a.kind === 'primary')
              const manifest = b.artifacts?.find((a) => a.kind === 'manifest')
              const active = !['COMPLETED', 'FAILED', 'CANCELLED'].includes(b.status)
              return (
                <div key={b.id} className="rounded border border-gray-800 p-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-gray-400">{b.id.slice(0, 8)}</span>
                    <Badge variant="outline" className="text-[9px]">{b.target}</Badge>
                    <Badge variant="outline" className="text-[9px]">v{b.version}</Badge>
                    {b.profile === 'debug' && <Badge variant="outline" className="text-[9px] text-amber-400">debug</Badge>}
                    <span className="text-[9px] text-gray-600">{b.provider}</span>
                    <span className={`font-bold uppercase ${STATUS_COLOR[b.status] ?? ''}`}>
                      {b.status === 'COMPLETED' && <CheckCircle2 className="mr-0.5 inline h-3 w-3" />}{b.status}
                    </span>
                    {b.artifactSize && <span className="text-[10px] text-gray-500">{(b.artifactSize / 1024 / 1024).toFixed(2)} Mo</span>}
                    <span className="ml-auto text-[10px] text-gray-600">{new Date(b.createdAt).toLocaleString()}</span>
                    {active && (
                      <Button size="sm" variant="outline" className="h-6 border-red-800 px-2 text-[10px] text-red-400 hover:bg-red-950" onClick={() => void cancel(b.id)}>
                        <XCircle className="mr-1 h-3 w-3" /> Annuler
                      </Button>
                    )}
                    {b.status === 'COMPLETED' && projectId && (
                      <a href={`/api/builds/${b.id}/artifact`} download>
                        <Button size="sm" className="h-6 bg-green-600 px-2 text-[10px] hover:bg-green-500">
                          <Download className="mr-1 h-3 w-3" /> Télécharger
                        </Button>
                      </a>
                    )}
                    {b.externalUrl && (
                      <a href={b.externalUrl} target="_blank" rel="noreferrer" className="text-[10px] text-sky-400 underline">run externe</a>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-800">
                    <div
                      className={`h-full transition-all ${b.status === 'FAILED' ? 'bg-red-500' : b.status === 'CANCELLED' ? 'bg-gray-600' : 'bg-green-500'}`}
                      style={{ width: `${b.progress}%` }}
                    />
                  </div>
                  {primary && (
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-gray-500">
                      <span className="font-mono">{primary.fileName}</span>
                      <span>sha256: <span className="font-mono">{primary.checksum.slice(0, 16)}…</span></span>
                      <span>{(primary.size / 1024).toFixed(1)} Ko</span>
                      {manifest && <a className="text-sky-400 underline" href={`/api/builds/${b.id}/artifact?artifact=${manifest.id}`} download>manifest.json</a>}
                    </div>
                  )}
                  {b.error && <p className="mt-1 whitespace-pre-wrap rounded bg-red-950/40 p-1.5 font-mono text-[10px] text-red-300">{b.error}</p>}
                  <div className="mt-1 max-h-28 overflow-y-auto rounded bg-gray-950 p-1.5 font-mono text-[10px] leading-4">
                    {parseLogs(b.logs).map((l, i) => (
                      <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-gray-400'}>
                        <span className="text-gray-600">{new Date(l.t).toLocaleTimeString()} </span>{l.msg}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
