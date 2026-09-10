// Editor global state (zustand) — doc, selection, tools, logs, runtime, project session.
'use client'
import { create } from 'zustand'
import { SceneDoc, createStarterScene } from '@/engine/scene'
import type { EntityData, ComponentType, ComponentData , ComponentBag } from '@/engine/types'
import type { TransformTool, CameraMode, QualityMode, RendererStats } from '@/engine/renderer'
import type { RuntimeState, RuntimeStats } from '@/engine/runtime'

export interface LogLine {
  id: number
  t: number
  level: 'info' | 'warn' | 'error'
  msg: string
}

export interface EditorAsset {
  id: string
  name: string
  folder: string
  kind: string
  mimeType: string
  size: number
  corrupted: boolean
  version: number
}

interface EditorState {
  // session
  user: { id: string; email: string; name: string; role: string; avatarColor: string } | null
  projectId: string | null
  projectName: string
  assets: EditorAsset[]
  scripts: Array<{ id: string; path: string; language: string; content: string }>

  // scene
  doc: SceneDoc | null
  docVersion: number
  selection: string[]
  dirty: boolean
  saving: boolean
  lastSavedAt: string | null

  // tools
  tool: TransformTool
  snap: boolean
  localSpace: boolean
  cameraMode: CameraMode
  quality: QualityMode
  gridVisible: boolean

  // runtime
  runtimeState: RuntimeState
  stats: RendererStats | null
  runtimeStats: RuntimeStats | null

  // logs
  logs: LogLine[]

  // actions
  setUser: (u: EditorState['user']) => void
  setProject: (id: string | null, name?: string) => void
  setDoc: (doc: SceneDoc) => void
  bumpVersion: () => void
  setSelection: (ids: string[]) => void
  addLog: (level: LogLine['level'], msg: string) => void
  clearLogs: () => void
  setTool: (t: TransformTool) => void
  setSnap: (v: boolean) => void
  setLocalSpace: (v: boolean) => void
  setCameraMode: (m: CameraMode) => void
  setQuality: (q: QualityMode) => void
  setGridVisible: (v: boolean) => void
  setRuntimeState: (s: RuntimeState) => void
  setStats: (s: RendererStats) => void
  setRuntimeStats: (s: RuntimeStats) => void
  markDirty: () => void
  setSaving: (v: boolean) => void
  setSaved: (at: string) => void
  setAssets: (a: EditorAsset[]) => void
  setScripts: (s: EditorState['scripts']) => void

  // scene ops
  selectEntity: (id: string | null, additive?: boolean) => void
  addEntity: (name: string, components?: ComponentBag) => EntityData | null
}

let logId = 0

export const useEditor = create<EditorState>((set, get) => ({
  user: null,
  projectId: null,
  projectName: '',
  assets: [],
  scripts: [],

  doc: null,
  docVersion: 0,
  selection: [],
  dirty: false,
  saving: false,
  lastSavedAt: null,

  tool: 'translate',
  snap: false,
  localSpace: false,
  cameraMode: 'orbit',
  quality: 'quality',
  gridVisible: true,

  runtimeState: 'stopped',
  stats: null,
  runtimeStats: null,

  logs: [],

  setUser: (user) => set({ user }),
  setProject: (projectId, projectName = '') => set({ projectId, projectName, assets: [], scripts: [] }),
  setDoc: (doc) => set({ doc, docVersion: get().docVersion + 1, selection: [] }),
  bumpVersion: () => set({ docVersion: get().docVersion + 1 }),
  setSelection: (selection) => set({ selection }),
  addLog: (level, msg) => set((s) => ({
    logs: [...s.logs.slice(-400), { id: ++logId, t: Date.now(), level, msg }],
  })),
  clearLogs: () => set({ logs: [] }),
  setTool: (tool) => set({ tool }),
  setSnap: (snap) => set({ snap }),
  setLocalSpace: (localSpace) => set({ localSpace }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setQuality: (quality) => set({ quality }),
  setGridVisible: (gridVisible) => set({ gridVisible }),
  setRuntimeState: (runtimeState) => set({ runtimeState }),
  setStats: (stats) => set({ stats }),
  setRuntimeStats: (runtimeStats) => set({ runtimeStats }),
  markDirty: () => set({ dirty: true }),
  setSaving: (saving) => set({ saving }),
  setSaved: (lastSavedAt) => set({ lastSavedAt, dirty: false, saving: false }),
  setAssets: (assets) => set({ assets }),
  setScripts: (scripts) => set({ scripts }),

  selectEntity: (id, additive = false) => {
    const cur = get().selection
    if (!id) { set({ selection: [] }); return }
    if (additive) {
      set({ selection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
    } else {
      set({ selection: [id] })
    }
  },

  addEntity: (name, components = {}) => {
    const doc = get().doc
    if (!doc) return null
    const entity = doc.createEntity(name, null, components)
    get().bumpVersion()
    get().markDirty()
    return entity
  },
}))

export { createStarterScene }
