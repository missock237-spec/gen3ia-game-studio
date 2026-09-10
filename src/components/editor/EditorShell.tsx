'use client'
// EditorShell — professional IDE layout: desktop resizable panels + mobile bottom nav.
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useEditor } from '@/stores/editor-store'
import AuthGate from '@/components/editor/AuthGate'
import GitHubDialog from '@/components/editor/GitHubDialog'
import BuildDialog from '@/components/editor/BuildDialog'
import HierarchyPanel from '@/components/editor/HierarchyPanel'
import InspectorPanel from '@/components/editor/InspectorPanel'
import AssetsPanel from '@/components/editor/AssetsPanel'
import AIAssistantPanel from '@/components/editor/AIAssistantPanel'
import MultiplayerPanel from '@/components/editor/MultiplayerPanel'
import ConsolePanel from '@/components/editor/ConsolePanel'
import ProfilerPanel from '@/components/editor/ProfilerPanel'
import CodeEditorPanel from '@/components/editor/CodeEditorPanel'
import { Button } from '@/components/ui/button'
import {
  Box, Boxes, Bot, Cloud, CloudOff, Code2, Layers, MessageSquare, Package,
  Save, Settings2, SlidersHorizontal, Terminal, Users,
} from 'lucide-react'

const ViewportPanel = dynamic(() => import('@/components/editor/ViewportPanel'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-[#0d1117] text-xs text-gray-500">Chargement du moteur 3D…</div>,
})

type MobilePanel = 'hierarchy' | 'viewport' | 'inspector' | 'assets' | 'code' | 'ai' | 'mp'

export default function EditorShell() {
  const user = useEditor((s) => s.user)
  const projectId = useEditor((s) => s.projectId)
  const projectName = useEditor((s) => s.projectName)
  const dirty = useEditor((s) => s.dirty)
  const saving = useEditor((s) => s.saving)
  const lastSavedAt = useEditor((s) => s.lastSavedAt)
  const doc = useEditor((s) => s.doc)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('viewport')
  const [bottomTab, setBottomTab] = useState<'console' | 'profiler'>('console')
  const [isMobile, setIsMobile] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── autosave every 25s + snapshot every 5 min ──
  useEffect(() => {
    if (!projectId) return
    const iv = setInterval(async () => {
      const s = useEditor.getState()
      if (!s.dirty || s.saving || savingRef.current || !s.doc) return
      savingRef.current = true
      s.setSaving(true)
      try {
        await fetch(`/api/projects/${projectId}/scene`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneData: JSON.parse(s.doc.toJSON()) }),
        }).then((r) => {
          if (r.ok) s.setSaved(new Date().toISOString())
          else s.addLog('error', `Autosave échoué (${r.status})`)
        })
      } catch {
        s.setSaving(false)
        s.addLog('warn', 'Autosave: réseau indisponible')
      } finally {
        savingRef.current = false
      }
    }, 25_000)
    return () => clearInterval(iv)
  }, [projectId])

  // snapshot every 5 minutes
  useEffect(() => {
    if (!projectId) return
    const iv = setInterval(async () => {
      const s = useEditor.getState()
      if (!s.doc) return
      await fetch(`/api/projects/${projectId}/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'autosave 5 min' }),
      }).catch(() => {})
    }, 300_000)
    return () => clearInterval(iv)
  }, [projectId])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).closest?.('.monaco-editor')) return
      const s = useEditor.getState()
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); if (s.doc?.canUndo()) { s.doc.undo(); s.bumpVersion(); s.markDirty() } }
        if (e.key === 'y') { e.preventDefault(); if (s.doc?.canRedo()) { s.doc.redo(); s.bumpVersion(); s.markDirty() } }
        if (e.key === 's') { e.preventDefault(); void saveNow() }
        if (e.key === 'd' && s.selection.length > 0) {
          e.preventDefault()
          s.doc?.duplicateEntity(s.selection[0], 1)
          s.bumpVersion(); s.markDirty()
        }
        if (e.key === 'Delete' && s.selection.length > 0) {
          s.doc?.deleteEntity(s.selection[0])
          s.setSelection([])
          s.bumpVersion(); s.markDirty()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const saveNow = useCallback(async () => {
    const s = useEditor.getState()
    if (!projectId || !s.doc) return
    s.setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/scene`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneData: JSON.parse(s.doc.toJSON()) }),
      })
      if (res.ok) {
        s.setSaved(new Date().toISOString())
        s.addLog('info', 'Scène sauvegardée')
      } else {
        s.setSaving(false)
        s.addLog('error', `Sauvegarde échouée (${res.status})`)
      }
    } catch {
      s.setSaving(false)
    }
  }, [projectId])

  const snapshot = async () => {
    await fetch(`/api/projects/${projectId}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Manuel' }),
    })
    useEditor.getState().addLog('info', 'Snapshot créé (version de la scène)')
  }

  if (!user) return <AuthGate />
  if (!projectId) return <AuthGate />

  const saveIndicator = saving ? (
    <span className="flex items-center gap-1 text-[10px] text-amber-400"><Cloud className="h-3 w-3 animate-pulse" /> sauvegarde…</span>
  ) : dirty ? (
    <span className="flex items-center gap-1 text-[10px] text-gray-500"><CloudOff className="h-3 w-3" /> non sauvegardé</span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] text-green-500"><Cloud className="h-3 w-3" /> {lastSavedAt ? `sauvé ${new Date(lastSavedAt).toLocaleTimeString()}` : 'à jour'}</span>
  )

  // ─────────────────── MOBILE ───────────────────
  if (isMobile) {
    return (
      <div className="flex h-[100dvh] flex-col bg-[#0b0f16]">
        <header className="flex items-center gap-2 border-b border-gray-800 px-3 py-2">
          <Box className="h-4 w-4 text-amber-400" />
          <span className="truncate text-xs font-semibold text-gray-200">{projectName}</span>
          <div className="ml-auto flex items-center gap-1">
            {saveIndicator}
            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400" onClick={() => void saveNow()} aria-label="Sauvegarder"><Save className="h-3.5 w-3.5" /></Button>
          </div>
        </header>

        <main className="relative min-h-0 flex-1">
          {mobilePanel === 'viewport' && (
            <ViewportHost>
              <ViewportPanel />
            </ViewportHost>
          )}
          {mobilePanel !== 'viewport' && (
            <ViewportHost hidden>
              <ViewportPanel />
            </ViewportHost>
          )}
          <div className={`absolute inset-0 bg-[#0b0f16] ${mobilePanel === 'hierarchy' ? '' : 'hidden'}`}>
            <HierarchyPanel />
          </div>
          <div className={`absolute inset-0 bg-[#0b0f16] ${mobilePanel === 'inspector' ? '' : 'hidden'}`}>
            <InspectorPanel />
          </div>
          <div className={`absolute inset-0 bg-[#0b0f16] ${mobilePanel === 'assets' ? '' : 'hidden'}`}>
            <AssetsPanel />
          </div>
          <div className={`absolute inset-0 bg-[#0b0f16] ${mobilePanel === 'code' ? '' : 'hidden'}`}>
            <CodeEditorPanel />
          </div>
          <div className={`absolute inset-0 flex flex-col bg-[#0b0f16] ${mobilePanel === 'ai' ? '' : 'hidden'}`}>
            <AIAssistantPanel />
          </div>
          <div className={`absolute inset-0 bg-[#0b0f16] ${mobilePanel === 'mp' ? '' : 'hidden'}`}>
            <MultiplayerPanel />
          </div>
        </main>

        <nav className="grid grid-cols-7 border-t border-gray-800 bg-[#0d1117] pb-[env(safe-area-inset-bottom)]">
          <NavBtn active={mobilePanel === 'hierarchy'} onClick={() => setMobilePanel('hierarchy')} label="Scène"><Layers className="h-4 w-4" /></NavBtn>
          <NavBtn active={mobilePanel === 'viewport'} onClick={() => setMobilePanel('viewport')} label="3D"><Box className="h-4 w-4" /></NavBtn>
          <NavBtn active={mobilePanel === 'inspector'} onClick={() => setMobilePanel('inspector')} label="Édit"><SlidersHorizontal className="h-4 w-4" /></NavBtn>
          <NavBtn active={mobilePanel === 'assets'} onClick={() => setMobilePanel('assets')} label="Assets"><Boxes className="h-4 w-4" /></NavBtn>
          <NavBtn active={mobilePanel === 'code'} onClick={() => setMobilePanel('code')} label="Code"><Code2 className="h-4 w-4" /></NavBtn>
          <NavBtn active={mobilePanel === 'ai'} onClick={() => setMobilePanel('ai')} label="IA"><Bot className="h-4 w-4" /></NavBtn>
          <NavBtn active={mobilePanel === 'mp'} onClick={() => setMobilePanel('mp')} label="Multi"><Users className="h-4 w-4" /></NavBtn>
        </nav>
      </div>
    )
  }

  // ─────────────────── DESKTOP ───────────────────
  return (
    <div className="flex h-screen flex-col bg-[#0b0f16]">
      {/* top bar */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-gray-800 px-3">
        <Box className="h-5 w-5 text-amber-400" />
        <span className="text-sm font-bold tracking-wide text-white">GEN3IA</span>
        <span className="text-xs text-gray-500">GAME STUDIO</span>
        <span className="mx-1 h-4 w-px bg-gray-800" />
        <span className="max-w-40 truncate text-xs text-gray-300">{projectName}</span>
        {saveIndicator}
        <div className="ml-2 flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-gray-300" onClick={() => void saveNow()} disabled={saving || !doc}>
            <Save className="mr-1 h-3.5 w-3.5" /> Sauver
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-gray-300" onClick={() => void snapshot()} disabled={!doc}>
            <Package className="mr-1 h-3.5 w-3.5" /> Snapshot
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <GitHubDialog />
          <BuildDialog />
          <Button variant="ghost" size="sm" className="h-8 text-xs text-gray-300 hover:text-white" onClick={() => setBottomTab('profiler')}>
            <Settings2 className="mr-1 h-4 w-4" /> Profiler
          </Button>
        </div>
      </header>

      {/* main 3-column layout */}
      <div className="flex min-h-0 flex-1">
        {/* left */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 lg:w-64">
          <div className="min-h-0 flex-[3]">
            <PanelTitle>Hiérarchie</PanelTitle>
            <div className="h-[calc(100%-24px)]"><HierarchyPanel /></div>
          </div>
          <div className="min-h-0 flex-[2] border-t border-gray-800">
            <PanelTitle>Assets</PanelTitle>
            <div className="h-[calc(100%-24px)]"><AssetsPanel /></div>
          </div>
        </aside>

        {/* center */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ViewportHost>
              <ViewportPanel />
            </ViewportHost>
          </div>
          {/* bottom dock */}
          <div className="h-44 shrink-0 border-t border-gray-800">
            <div className="flex items-center gap-1 border-b border-gray-800 px-2 py-0.5">
              <button
                onClick={() => setBottomTab('console')}
                className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ${bottomTab === 'console' ? 'bg-gray-800 text-amber-300' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Terminal className="mr-1 inline h-3 w-3" /> Console
              </button>
              <button
                onClick={() => setBottomTab('profiler')}
                className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ${bottomTab === 'profiler' ? 'bg-gray-800 text-amber-300' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Settings2 className="mr-1 inline h-3 w-3" /> Profiler
              </button>
            </div>
            <div className="h-[calc(100%-25px)]">
              {bottomTab === 'console' ? <ConsolePanel /> : <ProfilerPanel />}
            </div>
          </div>
        </main>

        {/* right */}
        <aside className="flex w-64 shrink-0 flex-col border-l border-gray-800 lg:w-72">
          <div className="min-h-0 flex-1">
            <PanelTitle>Inspecteur</PanelTitle>
            <div className="h-[calc(100%-24px)]"><InspectorPanel /></div>
          </div>
          <div className="h-72 min-h-0 border-t border-gray-800">
            <PanelTitle>AI Assistant</PanelTitle>
            <div className="h-[calc(100%-24px)]"><AIAssistantPanel /></div>
          </div>
          <div className="h-56 min-h-0 border-t border-gray-800">
            <PanelTitle>Multiplayer</PanelTitle>
            <div className="h-[calc(100%-24px)]"><MultiplayerPanel /></div>
          </div>
        </aside>
      </div>

      {/* code editor drawer (desktop) */}
      <details className="border-t border-gray-800">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-gray-500 hover:text-gray-300">
          <Code2 className="h-3.5 w-3.5" /> Éditeur de code (Monaco)
        </summary>
        <div className="h-80"><CodeEditorPanel /></div>
      </details>
    </div>
  )
}

function ViewportHost({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  return <div className={`h-full w-full ${hidden ? 'invisible absolute' : ''}`}>{children}</div>
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-6 items-center gap-1.5 border-b border-gray-800 bg-[#0d1117] px-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
      {children}
    </div>
  )
}

function NavBtn({ children, onClick, label, active }: {
  children: React.ReactNode; onClick: () => void; label: string; active: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[9px] ${active ? 'text-amber-400' : 'text-gray-500'}`}
      aria-label={label}
    >
      {children}
      {label}
    </button>
  )
}

export { MessageSquare }
