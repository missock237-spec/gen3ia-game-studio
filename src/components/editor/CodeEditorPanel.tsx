'use client'
// Code editor — Monaco, multi-file: entity scripts + project scripts.
import { useEffect, useMemo, useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import { Button } from '@/components/ui/button'
import { validateScriptSyntax } from '@/engine/scripting'
import { FileCode, Plus, Save } from 'lucide-react'

interface VirtualFile {
  key: string
  label: string
  language: string
  kind: 'entity' | 'project'
  entityId?: string
  scriptId?: string
  getValue: () => string
  setValue: (v: string) => void
  save: () => Promise<void>
}

export default function CodeEditorPanel() {
  const doc = useEditor((s) => s.doc)
  const docVersion = useEditor((s) => s.docVersion)
  const scripts = useEditor((s) => s.scripts)
  const projectId = useEditor((s) => s.projectId)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [newPath, setNewPath] = useState('')

  const files = useMemo<VirtualFile[]>(() => {
    const out: VirtualFile[] = []
    if (doc) {
      for (const e of Object.values(doc.doc.entities)) {
        if (e.components.script) {
          out.push({
            key: `entity:${e.id}`,
            label: `${e.name}.js`,
            language: 'javascript',
            kind: 'entity',
            entityId: e.id,
            getValue: () => e.components.script?.source ?? '',
            setValue: (v) => {
              const comp = e.components.script
              if (comp) comp.source = v
            },
            save: async () => { /* applied live to doc; autosave persists */ },
          })
        }
      }
    }
    for (const s of scripts) {
      out.push({
        key: `project:${s.id}`,
        label: s.path,
        language: s.language === 'glsl' ? 'c' : s.language === 'json' ? 'json' : 'typescript',
        kind: 'project',
        scriptId: s.id,
        getValue: () => s.content,
        setValue: (v) => { s.content = v },
        save: async () => {
          await fetch(`/api/projects/${projectId}/scripts/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: s.content }),
          })
        },
      })
    }
    return out
  }, [doc, docVersion, scripts, projectId])

  useEffect(() => {
    if (!activeKey && files.length > 0) setActiveKey(files[0].key)
  }, [files, activeKey])

  const active = files.find((f) => f.key === activeKey)

  useEffect(() => {
    if (active) setContent(active.getValue())
    setDirty(false)
    setError(null)
  }, [activeKey, active?.key])  

  const checkSyntax = (value: string): string | null => {
    const res = validateScriptSyntax(value)
    return res.ok ? null : res.error ?? 'Erreur de syntaxe'
  }

  const save = async () => {
    if (!active) return
    setSaving(true)
    try {
      if (active.kind === 'entity') {
        const err = checkSyntax(content)
        if (err) { setError(err); return }
        active.setValue(content)
        useEditor.getState().bumpVersion()
        useEditor.getState().markDirty()
        useEditor.getState().addLog('info', `Script enregistré sur « ${active.label} »`)
      } else {
        await active.save()
        useEditor.getState().addLog('info', `Fichier projet enregistré: ${active.label}`)
      }
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const createFile = async () => {
    if (!projectId || !/^[\w/-]+\.(ts|js|glsl|wgsl|json)$/.test(newPath.trim())) return
    const res = await fetch(`/api/projects/${projectId}/scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath.trim(), content: '// Nouveau script GEN3IA\n' }),
    })
    if (res.ok) {
      const { script } = await res.json()
      useEditor.getState().setScripts([...scripts, script])
      setNewPath('')
      setActiveKey(`project:${script.id}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* file tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-800 px-2 py-1">
        {files.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveKey(f.key)}
            className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] ${activeKey === f.key ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <FileCode className="h-3 w-3" /> {f.label}
          </button>
        ))}
        <span className="ml-2 flex shrink-0 items-center gap-1">
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="scripts/nouveau.ts"
            className="h-6 w-36 rounded bg-gray-900 px-1.5 text-[10px] text-gray-300 outline-none ring-1 ring-gray-800 focus:ring-amber-500/40"
          />
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => void createFile()} aria-label="Nouveau fichier">
            <Plus className="h-3 w-3" />
          </Button>
        </span>
      </div>

      {/* editor */}
      <div className="min-h-0 flex-1">
        {active ? (
          <MonacoLite
            value={content}
            language={active.language}
            onChange={(v) => { setContent(v); setDirty(true); setError(checkSyntax(v)) }}
          />
        ) : (
          <p className="p-3 text-xs text-gray-500">
            Aucun fichier. Ajoutez un composant Script à une entité, ou créez un fichier projet ci-dessus.
          </p>
        )}
      </div>

      {/* status bar */}
      <div className="flex items-center gap-2 border-t border-gray-800 px-3 py-1 text-[10px]">
        {error ? <span className="text-red-400">⚠ {error}</span> : <span className="text-green-500">Syntaxe OK</span>}
        <span className="text-gray-600">API sandbox: ctx.entity · ctx.input · ctx.math · ctx.log — interdit: fetch, require, eval…</span>
        <Button size="sm" className="ml-auto h-6 bg-amber-500 text-black hover:bg-amber-400" disabled={!dirty || saving} onClick={() => void save()}>
          <Save className="mr-1 h-3 w-3" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  )
}

/** Monaco wrapper — loaded client-side only */
function MonacoLite({ value, language, onChange }: {
  value: string; language: string; onChange: (v: string) => void
}) {
  const [Editor, setEditor] = useState<React.ComponentType<{ value: string; language: string; onChange: (v: string | undefined) => void; theme: string; options: Record<string, unknown> } | null> | null>(null)

  useEffect(() => {
    let mounted = true
    void import('@monaco-editor/react').then((mod) => {
      if (mounted) setEditor(() => mod.default as never)
    })
    return () => { mounted = false }
  }, [])

  if (!Editor) {
    return <div className="flex h-full items-center justify-center text-xs text-gray-500">Chargement de Monaco…</div>
  }
  return (
    <Editor
      value={value}
      language={language}
      theme="vs-dark"
      onChange={(v) => onChange(v ?? '')}
      options={{
        fontSize: 12,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
      }}
    />
  )
}
