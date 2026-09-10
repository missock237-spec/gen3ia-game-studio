'use client'
// GitHub dialog — connect repo, commit scene+scripts, trigger workflows (real API).
import { useEffect, useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { GitBranch, Github, Loader2, RefreshCw, Upload } from 'lucide-react'

interface GhStatus {
  serverTokenConfigured: boolean
  connected: boolean
  login: string | null
  repo: string | null
  branch: string | null
  lastCommitSha: string | null
}

export default function GitHubDialog() {
  const projectId = useEditor((s) => s.projectId)
  const addLog = useEditor((s) => s.addLog)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<GhStatus | null>(null)
  const [repoName, setRepoName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const refresh = async () => {
    if (!projectId) return
    const res = await fetch(`/api/projects/${projectId}/github`)
    if (res.ok) setStatus(await res.json())
  }

  useEffect(() => {
    if (open) void refresh()
  }, [open, projectId])

  const act = async (body: Record<string, unknown>, okMsg: (data: Record<string, unknown>) => string) => {
    if (!projectId) return
    setBusy(true); setError(null); setResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error?.message ?? `HTTP ${res.status}`)
      else { setResult(okMsg(data)); addLog('info', okMsg(data)) }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-gray-300 hover:text-white">
          <Github className="mr-1 h-4 w-4" /> GitHub
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" /> Intégration GitHub
          </DialogTitle>
        </DialogHeader>

        {!status ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.serverTokenConfigured ? 'default' : 'destructive'} className="text-[10px]">
                token serveur: {status.serverTokenConfigured ? 'configuré' : 'absent (GITHUB_TOKEN)'}
              </Badge>
              {status.login && <Badge variant="outline" className="text-[10px]">compte: {status.login}</Badge>}
            </div>

            {status.repo ? (
              <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-900/60 p-2">
                <GitBranch className="h-4 w-4 text-gray-400" />
                <div className="flex-1">
                  <div className="font-mono text-gray-200">{status.repo}</div>
                  <div className="text-[10px] text-gray-500">
                    branche {status.branch} · dernier commit {status.lastCommitSha?.slice(0, 7) ?? '—'}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void refresh()} aria-label="Rafraîchir"><RefreshCw className="h-3.5 w-3.5" /></Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="nom-du-depot" className="h-8" />
                <Button size="sm" disabled={busy || !repoName.trim()} className="shrink-0"
                  onClick={() => void act({ action: 'create-repo', name: repoName.trim(), isPrivate: true }, (d) => `Dépôt créé: ${(d.repo as { fullName: string }).fullName}`)}>
                  Créer le dépôt
                </Button>
              </div>
            )}

            {status.repo && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} className="bg-green-600 hover:bg-green-500"
                  onClick={() => void act({ action: 'commit' }, (d) => `Commit OK — sha ${String(d.sha).slice(0, 7)} (${d.committedFiles} fichiers: scene.json, scripts, workflows)`)}>
                  {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                  Committer scène + scripts + workflows
                </Button>
                <Button size="sm" variant="secondary" disabled={busy}
                  onClick={() => void act({ action: 'dispatch-build', platform: 'web' }, () => 'Workflow GitHub Actions déclenché (build-web.yml)')}>
                  Déclencher build-web.yml
                </Button>
              </div>
            )}

            {error && <p className="rounded bg-red-500/10 p-2 text-red-400">{error}</p>}
            {result && <p className="rounded bg-green-500/10 p-2 text-green-400">{result}</p>}
            <p className="text-[10px] text-gray-500">
              Le commit envoie game/scene.json, les scripts du projet et les workflows .github/workflows/build-web.yml.
              Le token ne quitte jamais le serveur (variable d&apos;environnement GITHUB_TOKEN).
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
