'use client'
// Assets panel — real upload/download/delete/rename, folders, previews, model import.
import { useMemo, useRef, useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Upload, FileImage, FileAudio, FileVideo, FileJson, FileCode, Box as BoxIcon, File as FileIcon,
  Trash2, Download, Pencil, FolderPlus, RefreshCw, Search, Crosshair,
} from 'lucide-react'

const FOLDER_ICONS: Record<string, React.ReactNode> = {
  texture: <FileImage className="h-8 w-8 text-emerald-400" />,
  audio: <FileAudio className="h-8 w-8 text-purple-400" />,
  video: <FileVideo className="h-8 w-8 text-pink-400" />,
  model: <BoxIcon className="h-8 w-8 text-amber-400" />,
  script: <FileCode className="h-8 w-8 text-sky-400" />,
  json: <FileJson className="h-8 w-8 text-yellow-400" />,
  other: <FileIcon className="h-8 w-8 text-gray-400" />,
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export default function AssetsPanel() {
  const assets = useEditor((s) => s.assets)
  const projectId = useEditor((s) => s.projectId)
  const addLog = useEditor((s) => s.addLog)
  const fileInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('/')
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const folders = useMemo(() => {
    const set = new Set<string>(['/'])
    for (const a of assets) set.add(a.folder)
    return [...set].sort()
  }, [assets])

  const visible = assets.filter((a) =>
    a.folder === folder && (search === '' || a.name.toLowerCase().includes(search.toLowerCase())))

  const refresh = async () => {
    if (!projectId) return
    const res = await fetch(`/api/projects/${projectId}/assets`)
    if (res.ok) {
      const data = await res.json()
      useEditor.getState().setAssets(data.assets)
    }
  }

  const upload = async (files: FileList) => {
    if (!projectId) return
    setBusy(true)
    for (const file of Array.from(files)) {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', folder)
      try {
        const res = await fetch(`/api/projects/${projectId}/assets`, { method: 'POST', body: form })
        const data = await res.json()
        if (!res.ok) {
          addLog('error', `Upload ${file.name}: ${data.error?.message ?? res.status}`)
        } else {
          addLog('info', `Asset uploadé: ${file.name} (${fmtSize(file.size)}) — sha256 vérifié${data.integrity?.corrupted ? ' ⚠ CORROMPU' : ''}`)
        }
      } catch (e) {
        addLog('error', `Upload ${file.name}: ${e instanceof Error ? e.message : e}`)
      }
    }
    setBusy(false)
    await refresh()
  }

  const remove = async (id: string, name: string) => {
    if (!projectId) return
    const res = await fetch(`/api/projects/${projectId}/assets/${id}`, { method: 'DELETE' })
    if (res.ok) {
      addLog('info', `Asset supprimé: ${name}`)
      await refresh()
    }
  }

  const rename = async (id: string, oldName: string) => {
    const name = window.prompt('Nouveau nom:', oldName)
    if (!name || name === oldName) return
    if (!projectId) return
    const res = await fetch(`/api/projects/${projectId}/assets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) await refresh()
  }

  /** Import a GLB/glTF model into the scene as a mesh entity (kind: model). */
  const importModel = async (assetId: string, name: string) => {
    const s = useEditor.getState()
    if (!s.doc) return
    s.doc.createEntity(name.replace(/\.[^.]+$/, ''), null, {
      mesh: { kind: 'model', assetId, castShadow: true, receiveShadow: true },
    })
    s.bumpVersion()
    s.markDirty()
    addLog('info', `Modèle importé dans la scène: ${name}`)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-gray-800 p-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un asset…" className="h-8 bg-gray-900 pl-7 text-xs" />
        </div>
        <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => fileInput.current?.click()} disabled={busy || !projectId} aria-label="Uploader">
          <Upload className="h-4 w-4" />
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = '' }}
        />
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void refresh()} aria-label="Rafraîchir">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* folders */}
      <div className="flex flex-wrap gap-1 border-b border-gray-800 p-2">
        {folders.map((f) => (
          <button
            key={f}
            onClick={() => setFolder(f)}
            className={`rounded px-2 py-0.5 text-[10px] ${folder === f ? 'bg-amber-500/25 text-amber-300' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          >
            <FolderPlus className="mr-0.5 inline h-3 w-3" />{f}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
          {visible.length === 0 && (
            <p className="col-span-full p-3 text-center text-[11px] text-gray-500">
              Aucun asset dans ce dossier. Uploadez des fichiers (PNG, GLB, MP3, WAV…).
            </p>
          )}
          {visible.map((a) => (
            <div key={a.id} className="group relative rounded border border-gray-800 bg-gray-900/60 p-2">
              <div className="flex flex-col items-center gap-1">
                {a.kind === 'texture' ? (
                   
                  <img
                    src={projectId ? `/api/projects/${projectId}/assets/${a.id}/blob` : ''}
                    alt={a.name}
                    className="h-10 w-10 rounded object-cover"
                    onClick={() => setPreview(a.id)}
                  />
                ) : FOLDER_ICONS[a.kind] ?? FOLDER_ICONS.other}
                <span className="w-full truncate text-center text-[10px] text-gray-300" title={a.name}>{a.name}</span>
                <span className="text-[9px] text-gray-500">
                  {fmtSize(a.size)} · v{a.version}{a.corrupted ? ' ⚠' : ''}
                </span>
              </div>
              <div className="absolute inset-x-1 top-1 hidden justify-end gap-0.5 group-hover:flex">
                {a.kind === 'model' && (
                  <IconBtn title="Importer dans la scène" onClick={() => void importModel(a.id, a.name)}><Crosshair className="h-3 w-3" /></IconBtn>
                )}
                <IconBtn title="Renommer" onClick={() => void rename(a.id, a.name)}><Pencil className="h-3 w-3" /></IconBtn>
                {projectId && (
                  <a href={`/api/projects/${projectId}/assets/${a.id}/blob`} download={a.name} title="Télécharger">
                    <IconBtn title="Télécharger"><Download className="h-3 w-3" /></IconBtn>
                  </a>
                )}
                <IconBtn title="Supprimer" danger onClick={() => void remove(a.id, a.name)}><Trash2 className="h-3 w-3" /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Prévisualisation</DialogTitle>
          </DialogHeader>
          {preview && projectId && (
             
            <img src={`/api/projects/${projectId}/assets/${preview}/blob`} alt="aperçu" className="max-h-96 w-full rounded object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IconBtn({ children, onClick, title, danger }: {
  children: React.ReactNode; onClick?: () => void; title: string; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded bg-black/70 p-1 ${danger ? 'text-red-400 hover:text-red-300' : 'text-gray-300 hover:text-white'}`}
    >
      {children}
    </button>
  )
}
