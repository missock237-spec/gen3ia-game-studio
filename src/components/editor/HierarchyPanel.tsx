'use client'
// Hierarchy panel — scene tree with search, visibility, lock, add/delete/duplicate.
import { useMemo, useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import type { EntityData } from '@/engine/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Box, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Lightbulb, Lock,
  LockOpen, Mountain, Plus, Search, Trash2, Droplets, CloudSun, CircleDot, User,
} from 'lucide-react'

const ADD_MENU: Array<{ label: string; icon: React.ReactNode; make: (doc: NonNullable<ReturnType<typeof useEditor.getState>['doc']>) => void }> = [
  {
    label: 'Cube', icon: <Box className="h-3.5 w-3.5" />, make: (doc) => { doc.createPrimitive('box') },
  },
  {
    label: 'Sphère', icon: <CircleDot className="h-3.5 w-3.5" />, make: (doc) => { doc.createPrimitive('sphere') },
  },
  {
    label: 'Cylindre', icon: <Box className="h-3.5 w-3.5" />, make: (doc) => { doc.createPrimitive('cylinder') },
  },
  {
    label: 'Cône', icon: <Box className="h-3.5 w-3.5" />, make: (doc) => { doc.createPrimitive('cone') },
  },
  {
    label: 'Tore', icon: <Box className="h-3.5 w-3.5" />, make: (doc) => { doc.createPrimitive('torus') },
  },
  {
    label: 'Lumière ponctuelle', icon: <Lightbulb className="h-3.5 w-3.5" />, make: (doc) => {
      doc.createEntity('Point Light', null, {
        light: { kind: 'point', color: '#ffffff', intensity: 10, castShadow: false, distance: 12, angle: 0, penumbra: 0.4 },
      })
    },
  },
  {
    label: 'Lumière directionnelle', icon: <Lightbulb className="h-3.5 w-3.5" />, make: (doc) => {
      doc.createEntity('Directional Light', null, {
        light: { kind: 'directional', color: '#fff4e0', intensity: 2.5, castShadow: true, distance: 0, angle: 0, penumbra: 0 },
      })
    },
  },
  {
    label: 'Terrain', icon: <Mountain className="h-3.5 w-3.5" />, make: (doc) => {
      doc.createEntity('Terrain', null, {
        terrain: { sizeX: 100, sizeZ: 100, segments: 96, seed: Math.floor(Math.random() * 100000), heightScale: 6, shape: 'hills', colorLow: '#3d6b3f', colorHigh: '#8a8f98' },
      })
    },
  },
  {
    label: 'Eau', icon: <Droplets className="h-3.5 w-3.5" />, make: (doc) => {
      doc.createEntity('Water', null, {
        water: { size: 60, level: -0.6, color: '#2a6f97', waveHeight: 0.18 },
      })
    },
  },
  {
    label: 'Ciel', icon: <CloudSun className="h-3.5 w-3.5" />, make: (doc) => {
      doc.createEntity('Sky', null, {
        sky: { turbidity: 6, rayleigh: 1.6, mieCoefficient: 0.005, mieDirectionalG: 0.8, sunElevation: 0.9, sunAzimuth: 0.6 },
      })
    },
  },
  {
    label: 'PNJ', icon: <User className="h-3.5 w-3.5" />, make: (doc) => {
      doc.createEntity('PNJ', null, {
        npc: {
          archetype: 'civilian', personality: 'Amical', faction: 'Village', profession: 'Artisan',
          aggression: 0.1, fear: 0.3, friendliness: 0.7, curiosity: 0.6,
          moveSpeed: 2.5, sightRange: 16, fovDeg: 140, hearingRange: 10,
          goals: ['patrol'], patrolRadius: 6, memoryCapacity: 20,
        },
        mesh: { kind: 'capsule', params: { radius: 0.4, length: 0.9 }, castShadow: true, receiveShadow: true },
        health: { max: 50, current: 50, regen: 0 },
      })
    },
  },
]

export default function HierarchyPanel() {
  const doc = useEditor((s) => s.doc)
  const docVersion = useEditor((s) => s.docVersion)
  const selection = useEditor((s) => s.selection)
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const roots = useMemo(() => {
    if (!doc) return []
    return doc.doc.rootOrder.map((id) => doc.get(id)).filter((e): e is EntityData => Boolean(e))
  }, [doc, docVersion])

  const matches = (e: EntityData): boolean => search === '' || e.name.toLowerCase().includes(search.toLowerCase())

  const renderEntity = (entity: EntityData, depth: number): React.ReactNode => {
    const children = (doc!.children(entity.id) as EntityData[]).filter(matches)
    const [open, setOpen] = [true, (_: boolean) => {}] // simple: always expanded
    void open; void setOpen
    return (
      <div key={entity.id}>
        <EntityRow entity={entity} depth={depth} hasChildren={children.length > 0} />
        {children.map((c) => renderEntity(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-800 p-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="h-8 bg-gray-900 pl-7 text-xs"
          />
        </div>
        <div className="relative">
          <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => setAddOpen(!addOpen)} aria-label="Ajouter une entité">
            <Plus className="h-4 w-4" />
          </Button>
          {addOpen && (
            <div className="absolute right-0 top-9 z-50 w-52 rounded-md border border-gray-700 bg-gray-900 py-1 shadow-xl">
              {ADD_MENU.map((item) => (
                <button
                  key={item.label}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
                  onClick={() => {
                    if (doc) { item.make(doc); useEditor.getState().bumpVersion(); useEditor.getState().markDirty() }
                    setAddOpen(false)
                  }}
                >
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1 text-xs">
          {!doc || roots.length === 0 ? (
            <p className="p-3 text-gray-500">Scène vide — ajoutez une entité (+).</p>
          ) : (
            roots.filter(matches).map((e) => renderEntity(e, 0))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function EntityRow({ entity, depth, hasChildren }: { entity: EntityData; depth: number; hasChildren: boolean }) {
  const selection = useEditor((s) => s.selection)
  const selected = selection.includes(entity.id)
  const runtime = useEditor((s) => s.runtimeState) !== 'stopped'

  const icon = entity.components.light ? <Lightbulb className="h-3.5 w-3.5 text-yellow-400" />
    : entity.components.terrain ? <Mountain className="h-3.5 w-3.5 text-green-500" />
    : entity.components.water ? <Droplets className="h-3.5 w-3.5 text-sky-400" />
    : entity.components.sky ? <CloudSun className="h-3.5 w-3.5 text-sky-300" />
    : entity.components.npc ? <User className="h-3.5 w-3.5 text-cyan-400" />
    : entity.components.mesh ? <Box className="h-3.5 w-3.5 text-gray-400" />
    : <Box className="h-3.5 w-3.5 text-gray-600" />

  const select = (e: React.MouseEvent) => {
    e.stopPropagation()
    useEditor.getState().selectEntity(entity.id, e.shiftKey || e.ctrlKey)
  }

  const toggleVisible = (e: React.MouseEvent) => {
    e.stopPropagation()
    const s = useEditor.getState()
    s.doc?.patchEntity(entity.id, { visible: !entity.visible }, 'Visibilité')
    s.bumpVersion(); s.markDirty()
  }
  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation()
    const s = useEditor.getState()
    s.doc?.patchEntity(entity.id, { locked: !entity.locked }, 'Verrou')
    s.bumpVersion(); s.markDirty()
  }
  const duplicate = (e: React.MouseEvent) => {
    e.stopPropagation()
    const s = useEditor.getState()
    s.doc?.duplicateEntity(entity.id, 1)
    s.bumpVersion(); s.markDirty()
  }
  const remove = (e: React.MouseEvent) => {
    e.stopPropagation()
    const s = useEditor.getState()
    s.doc?.deleteEntity(entity.id)
    s.setSelection(selection.filter((x) => x !== entity.id))
    s.bumpVersion(); s.markDirty()
  }

  return (
    <div
      className={`group flex cursor-pointer items-center gap-1 py-[3px] pr-1 hover:bg-gray-800/60 ${selected ? 'bg-amber-500/15' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={select}
      role="treeitem"
      aria-selected={selected}
    >
      {hasChildren ? <ChevronDown className="h-3 w-3 text-gray-600" /> : <ChevronRight className="h-3 w-3 text-transparent" />}
      {icon}
      <span className={`flex-1 truncate ${entity.visible ? '' : 'opacity-40'} ${entity.locked ? 'italic' : ''}`}>
        {entity.name}
        {entity.components.script && <span className="ml-1 rounded bg-purple-500/20 px-1 text-[9px] text-purple-300">JS</span>}
        {entity.components.npc && <span className="ml-1 rounded bg-cyan-500/20 px-1 text-[9px] text-cyan-300">IA</span>}
      </span>
      <span className="hidden gap-0.5 group-hover:flex">
        <button onClick={toggleVisible} className="p-0.5 text-gray-400 hover:text-white" aria-label="Visibilité">
          {entity.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
        <button onClick={toggleLock} className="p-0.5 text-gray-400 hover:text-white" aria-label="Verrouiller">
          {entity.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
        </button>
        {!runtime && (
          <>
            <button onClick={duplicate} className="p-0.5 text-gray-400 hover:text-white" aria-label="Dupliquer"><Copy className="h-3 w-3" /></button>
            <button onClick={remove} className="p-0.5 text-gray-400 hover:text-red-400" aria-label="Supprimer"><Trash2 className="h-3 w-3" /></button>
          </>
        )}
      </span>
    </div>
  )
}
