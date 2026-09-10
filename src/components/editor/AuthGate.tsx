'use client'
// Auth gate + project manager — real JWT login/register and cloud projects.
import { useEffect, useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Box, Loader2, LogOut, Plus } from 'lucide-react'

interface ProjectRow {
  id: string
  name: string
  description: string
  updatedAt: string
  _count: { assets: number; snapshots: number; builds: number }
}

export default function AuthGate() {
  const user = useEditor((s) => s.user)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/auth/me').then(async (r) => {
      const data = await r.json()
      if (data.user) useEditor.getState().setUser(data.user)
    }).catch(() => {})
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { email, password, name } : { email, password }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error?.message ?? `HTTP ${res.status}`)
      else useEditor.getState().setUser(data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#0b0f16] to-[#111827] p-4">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-gray-800 bg-gray-900/70 p-6 shadow-2xl">
          <div className="flex items-center gap-2">
            <Box className="h-7 w-7 text-amber-400" />
            <div>
              <h1 className="text-lg font-bold text-white">GEN3IA GAME STUDIO</h1>
              <p className="text-[11px] text-gray-500">Game engine cloud-first — créez des jeux 3D depuis votre navigateur</p>
            </div>
          </div>

          {mode === 'register' && (
            <div className="space-y-1">
              <Label htmlFor="name">Nom</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className="h-9" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Mot de passe</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="h-9" />
            {mode === 'register' && <p className="text-[10px] text-gray-500">8 caractères minimum</p>}
          </div>

          {error && <p className="rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}

          <Button type="submit" className="w-full bg-amber-500 text-black hover:bg-amber-400" disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {mode === 'login' ? 'Se connecter' : 'Créer un compte'}
          </Button>
          <button type="button" className="w-full text-center text-xs text-gray-400 hover:text-white" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Pas de compte ? Créez-en un' : 'Déjà un compte ? Connectez-vous'}
          </button>
        </form>
      </div>
    )
  }

  return <ProjectManager />
}

function ProjectManager() {
  const user = useEditor((s) => s.user)
  const setProject = useEditor((s) => s.setProject)
  const setDoc = useEditor((s) => s.setDoc)
  const addLog = useEditor((s) => s.addLog)
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch('/api/projects')
    if (res.ok) setProjects((await res.json()).projects)
    else setProjects([])
  }

  useEffect(() => { void load() }, [])

  const create = async () => {
    if (!newName.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), template: 'starter' }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error?.message ?? `HTTP ${res.status}`); return }
      await open(data.project.id, data.project.name)
    } finally {
      setBusy(false)
    }
  }

  const open = async (id: string, name: string) => {
    setProject(id, name)
    const res = await fetch(`/api/projects/${id}/scene`)
    if (res.ok) {
      const data = await res.json()
      setDoc(await sceneFromJSON(data.sceneData))
    }
    // assets + scripts
    const assetsRes = await fetch(`/api/projects/${id}/assets`)
    if (assetsRes.ok) useEditor.getState().setAssets((await assetsRes.json()).assets)
    const scriptsRes = await fetch(`/api/projects/${id}/scripts`)
    if (scriptsRes.ok) useEditor.getState().setScripts((await scriptsRes.json()).scripts)
    addLog('info', `Projet ouvert: ${name}`)
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    useEditor.getState().setUser(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#0b0f16] to-[#111827] p-4">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box className="h-7 w-7 text-amber-400" />
            <div>
              <h1 className="text-lg font-bold text-white">GEN3IA GAME STUDIO</h1>
              <p className="text-[11px] text-gray-500">Bienvenue, {user?.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void logout()} className="text-gray-400">
            <LogOut className="mr-1 h-4 w-4" /> Déconnexion
          </Button>
        </div>

        <div className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom du nouveau projet…" className="h-10 bg-gray-900" onKeyDown={(e) => { if (e.key === 'Enter') void create() }} />
          <Button className="bg-amber-500 text-black hover:bg-amber-400" disabled={busy || !newName.trim()} onClick={() => void create()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Créer
          </Button>
        </div>
        {error && <p className="rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}

        <div className="space-y-2">
          {projects === null && <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-500" />}
          {projects?.length === 0 && <p className="text-center text-sm text-gray-500">Aucun projet — créez le vôtre ci-dessus.</p>}
          {projects?.map((p) => (
            <button
              key={p.id}
              onClick={() => void open(p.id, p.name)}
              className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/70 p-4 text-left transition-colors hover:border-amber-500/40 hover:bg-gray-900"
            >
              <Box className="h-8 w-8 shrink-0 text-amber-400/70" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-gray-100">{p.name}</div>
                <div className="text-[11px] text-gray-500">
                  {p._count.assets} assets · {p._count.snapshots} snapshots · {p._count.builds} builds · modifié {new Date(p.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <span className="text-xs text-amber-400">Ouvrir →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

async function sceneFromJSON(json: unknown) {
  const { SceneDoc } = await import('@/engine/scene')
  return SceneDoc.fromJSON(json as string)
}
