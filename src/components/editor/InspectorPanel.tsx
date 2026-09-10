'use client'
// Inspector — real per-component editors for the selected entity.
import { useState } from 'react'
import { useEditor } from '@/stores/editor-store'
import type { ComponentType, ComponentData, ComponentBag, EntityData } from '@/engine/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, Trash2, Code2 } from 'lucide-react'

const ALL_COMPONENTS: ComponentType[] = [
  'mesh', 'material', 'light', 'camera', 'rigidBody', 'collider', 'characterController',
  'script', 'audio', 'particleEmitter', 'terrain', 'water', 'sky', 'fog', 'npc', 'health',
  'inventory', 'quest', 'network', 'player', 'interactable', 'trigger', 'lod', 'waypoint',
]

export default function InspectorPanel() {
  const doc = useEditor((s) => s.doc)
  const docVersion = useEditor((s) => s.docVersion)
  const selection = useEditor((s) => s.selection)

  const entity = doc && selection.length === 1 ? doc.get(selection[0]) : undefined

  if (!doc) return <div className="p-3 text-xs text-gray-500">Aucune scène.</div>
  if (selection.length > 1) {
    return <div className="p-3 text-xs text-gray-400">{selection.length} entités sélectionnées — gizmo actif sur la première.</div>
  }
  if (!entity) {
    return <div className="p-3 text-xs text-gray-500">Sélectionnez une entité dans la hiérarchie ou le viewport.</div>
  }

  const patch = (fn: () => void) => {
    fn()
    useEditor.getState().bumpVersion()
    useEditor.getState().markDirty()
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3 text-xs">
        {/* identity */}
        <div className="space-y-2">
          <Label className="text-[10px] uppercase tracking-wider text-gray-500">Entité</Label>
          <Input
            value={entity.name}
            onChange={(e) => patch(() => { entity.name = e.target.value })}
            className="h-8"
          />
          <div className="flex flex-wrap items-center gap-3 text-gray-400">
            <label className="flex items-center gap-1.5">
              <Switch checked={entity.visible} onCheckedChange={(v) => patch(() => { doc.patchEntity(entity.id, { visible: v }) })} /> Visible
            </label>
            <label className="flex items-center gap-1.5">
              <Switch checked={entity.locked} onCheckedChange={(v) => patch(() => { doc.patchEntity(entity.id, { locked: v }) })} /> Verrouillé
            </label>
            <label className="flex items-center gap-1.5">
              <Switch checked={entity.isStatic} onCheckedChange={(v) => patch(() => { doc.patchEntity(entity.id, { isStatic: v }) })} /> Statique
            </label>
          </div>
          <Input
            placeholder="tags (séparés par des virgules)"
            value={entity.tags.join(', ')}
            onChange={(e) => patch(() => { doc.patchEntity(entity.id, { tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }) })}
            className="h-7"
          />
        </div>

        {(['transform', 'mesh', 'material', 'light', 'camera', 'rigidBody', 'collider', 'characterController', 'script', 'audio', 'particleEmitter', 'terrain', 'water', 'sky', 'fog', 'npc', 'health'] as ComponentType[])
          .filter((k) => entity.components[k])
          .map((key) => (
            <ComponentEditor key={`${key}-${docVersion}`} entity={entity} type={key} patch={patch} />
          ))}

        {/* add component */}
        <details className="rounded border border-gray-800">
          <summary className="flex cursor-pointer items-center gap-1 p-2 text-gray-400 hover:text-white">
            <Plus className="h-3.5 w-3.5" /> Ajouter un composant
          </summary>
          <div className="grid grid-cols-2 gap-1 p-2 pt-0">
            {ALL_COMPONENTS.filter((k) => !entity.components[k]).map((k) => (
              <button
                key={k}
                className="rounded bg-gray-800 px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-gray-700"
                onClick={() => patch(() => {
                  const defaults: Record<string, unknown> = {
                    mesh: { kind: 'box', params: { width: 1, height: 1, depth: 1 }, castShadow: true, receiveShadow: true },
                    material: { color: '#9aa5b1', metalness: 0.05, roughness: 0.75, emissive: '#000000', emissiveIntensity: 0, opacity: 1, wireframe: false, doubleSided: false },
                    light: { kind: 'point', color: '#ffffff', intensity: 10, castShadow: false, distance: 12, angle: 0, penumbra: 0.4 },
                    camera: { fov: 60, near: 0.1, far: 500, active: false },
                    rigidBody: { type: 'dynamic', mass: 5, restitution: 0.2, friction: 0.5, linearDamping: 0.01, angularDamping: 0.05, useGravity: true, freezeRotation: false },
                    collider: { shape: 'box', isTrigger: false },
                    characterController: { moveSpeed: 5, jumpForce: 6, rotateSpeed: 10, grounded: false },
                    script: { enabled: true, source: 'function onStart(ctx) {\n  ctx.log("Hello depuis ' + entity.name + '")\n}\n\nfunction onUpdate(ctx, dt) {\n}\n' },
                    audio: { assetId: '', volume: 0.8, loop: false, autoplay: false },
                    particleEmitter: { count: 80, color: '#9fd8ff', colorEnd: '#3b82a0', size: 0.08, speed: 3, lifetime: 1.2, spread: 0.4, gravity: -5, looping: true },
                    terrain: { sizeX: 80, sizeZ: 80, segments: 64, seed: 42, heightScale: 5, shape: 'hills', colorLow: '#3d6b3f', colorHigh: '#8a8f98' },
                    water: { size: 50, level: 0, color: '#2a6f97', waveHeight: 0.15 },
                    sky: { turbidity: 6, rayleigh: 1.6, mieCoefficient: 0.005, mieDirectionalG: 0.8, sunElevation: 0.9, sunAzimuth: 0.6 },
                    fog: { color: '#aac4e0', density: 0.006 },
                    npc: { archetype: 'civilian', personality: '', faction: 'Neutre', profession: '', aggression: 0.2, fear: 0.3, friendliness: 0.5, curiosity: 0.5, moveSpeed: 2.5, sightRange: 15, fovDeg: 140, hearingRange: 10, goals: ['patrol'], patrolRadius: 5, memoryCapacity: 20 },
                    health: { max: 100, current: 100, regen: 0 },
                    inventory: { slots: 20, items: [] },
                    quest: { questId: '', title: 'Nouvelle quête', description: '', objectives: [], state: 'draft' },
                    network: { sync: true, syncRate: 10 },
                    player: { isSpawn: true },
                    interactable: { prompt: 'Interagir', action: '', range: 2 },
                    trigger: { size: { x: 1, y: 1, z: 1 }, once: true, event: 'onEnter' },
                    lod: { levels: [20, 50, 100] },
                    waypoint: { index: 0, loop: true },
                  }
                  doc.addComponent(entity.id, k, defaults[k] as never)
                })}
              >
                + {k}
              </button>
            ))}
          </div>
        </details>

        {/* remove components */}
        {Object.keys(entity.components).length > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-gray-800 pt-2">
            {Object.keys(entity.components).filter((k) => k !== 'transform').map((k) => (
              <Button key={k} size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-gray-500 hover:text-red-400"
                onClick={() => patch(() => { doc.removeComponent(entity.id, k as ComponentType) })}>
                <Trash2 className="mr-1 h-3 w-3" />{k}
              </Button>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ─────────────────── generic component editors ───────────────────

function ComponentEditor({ entity, type, patch }: {
  entity: EntityData; type: ComponentType; patch: (fn: () => void) => void
}) {
  const doc = useEditor((s) => s.doc)!
  const comp = entity.components[type] as unknown as Record<string, unknown>
  const set = (key: string, value: unknown) => patch(() => {
    doc.patchComponent(entity.id, type, { [key]: value } as never, `Modifier ${type}.${key}`)
  })

  const num = (key: string, label: string, step = 0.1, min?: number, max?: number) => (
    <NumField label={label} value={Number(comp[key] ?? 0)} onChange={(v) => set(key, v)} step={step} min={min} max={max} />
  )
  const color = (key: string, label: string) => (
    <ColorField label={label} value={String(comp[key] ?? '#ffffff')} onChange={(v) => set(key, v)} />
  )
  const bool = (key: string, label: string) => (
    <label className="flex items-center justify-between py-1 text-gray-300">
      {label}
      <Switch checked={Boolean(comp[key])} onCheckedChange={(v) => set(key, v)} />
    </label>
  )

  const headers: Partial<Record<ComponentType, string>> = {
    transform: 'Transform', mesh: 'Mesh', material: 'Material (PBR)', light: 'Light', camera: 'Camera',
    rigidBody: 'RigidBody (physique)', collider: 'Collider', characterController: 'Character Controller',
    script: 'Script (sandbox)', audio: 'Audio', particleEmitter: 'Particle Emitter', terrain: 'Terrain',
    water: 'Water', sky: 'Sky (atmosphère)', fog: 'Fog', npc: 'Cerveau PNJ (IA hybride)', health: 'Health',
  }

  return (
    <div className="rounded border border-gray-800 bg-gray-900/40 p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">{headers[type] ?? type}</span>
        {type === 'script' && <CodeBadge />}
      </div>
      <div className="space-y-1.5">
        {type === 'transform' && (
          <>
            <Vec3Field label="Position" value={comp.position as never} onChange={(v) => set('position', v)} />
            <Vec3Field label="Rotation (rad)" value={comp.rotation as never} onChange={(v) => set('rotation', v)} />
            <Vec3Field label="Scale" value={comp.scale as never} onChange={(v) => set('scale', v)} />
          </>
        )}
        {type === 'mesh' && (
          <>
            <label className="block text-gray-300">
              Type
              <select
                className="mt-1 w-full rounded bg-gray-800 p-1.5 text-gray-100"
                value={String(comp.kind)}
                onChange={(e) => set('kind', e.target.value)}
              >
                {['box', 'sphere', 'cylinder', 'cone', 'plane', 'capsule', 'torus', 'model'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {comp.kind === 'model' ? (
              <ModelAssetPicker value={String(comp.assetId ?? '')} onChange={(v) => set('assetId', v)} />
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {Object.entries((comp.params as Record<string, number>) ?? {}).map(([k, v]) => (
                  <NumField key={k} label={k} value={v} onChange={(nv) => set('params', { ...(comp.params as object), [k]: nv })} />
                ))}
              </div>
            )}
            {bool('castShadow', 'Projette une ombre')}
            {bool('receiveShadow', 'Reçoit les ombres')}
          </>
        )}
        {type === 'material' && (
          <>
            {color('color', 'Couleur')}
            <RangeField label="Metalness" value={Number(comp.metalness)} onChange={(v) => set('metalness', v)} />
            <RangeField label="Roughness" value={Number(comp.roughness)} onChange={(v) => set('roughness', v)} />
            {color('emissive', 'Émission')}
            {num('emissiveIntensity', 'Intensité émission', 0.1, 0, 20)}
            <RangeField label="Opacité" value={Number(comp.opacity)} onChange={(v) => set('opacity', v)} />
            {bool('wireframe', 'Wireframe')}
            {bool('doubleSided', 'Double face')}
            <TextureAssetPicker label="Texture" value={String(comp.textureAssetId ?? '')} onChange={(v) => set('textureAssetId', v || undefined)} />
          </>
        )}
        {type === 'light' && (
          <>
            <label className="block text-gray-300">
              Type
              <select className="mt-1 w-full rounded bg-gray-800 p-1.5 text-gray-100" value={String(comp.kind)} onChange={(e) => set('kind', e.target.value)}>
                {['ambient', 'directional', 'point', 'spot', 'hemisphere'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {color('color', 'Couleur')}
            {num('intensity', 'Intensité', 0.5, 0, 100)}
            {num('distance', 'Portée', 0.5, 0, 200)}
            {bool('castShadow', 'Ombres')}
          </>
        )}
        {type === 'camera' && <>{num('fov', 'FOV', 1, 20, 140)}{num('near', 'Near', 0.01)}{num('far', 'Far', 10)}{bool('active', 'Caméra active')}</>}
        {type === 'rigidBody' && (
          <>
            <label className="block text-gray-300">
              Type de corps
              <select className="mt-1 w-full rounded bg-gray-800 p-1.5 text-gray-100" value={String(comp.type)} onChange={(e) => set('type', e.target.value)}>
                {['static', 'dynamic', 'kinematic'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {num('mass', 'Masse', 0.5, 0)}
            <RangeField label="Restitution" value={Number(comp.restitution)} onChange={(v) => set('restitution', v)} />
            <RangeField label="Friction" value={Number(comp.friction)} onChange={(v) => set('friction', v)} />
            {bool('useGravity', 'Gravité')}
            {bool('freezeRotation', 'Bloquer la rotation')}
          </>
        )}
        {type === 'collider' && (
          <>
            <label className="block text-gray-300">
              Forme
              <select className="mt-1 w-full rounded bg-gray-800 p-1.5 text-gray-100" value={String(comp.shape)} onChange={(e) => set('shape', e.target.value)}>
                {['box', 'sphere', 'cylinder', 'capsule', 'mesh'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {bool('isTrigger', 'Trigger (capteur)')}
          </>
        )}
        {type === 'characterController' && <>{num('moveSpeed', 'Vitesse', 0.5, 0)}{num('jumpForce', 'Force de saut', 0.5, 0)}</>}
        {type === 'script' && <ScriptEditor entity={entity} source={String(comp.source ?? '')} enabled={Boolean(comp.enabled)} patch={patch} />}
        {type === 'particleEmitter' && (
          <>
            {num('count', 'Nombre', 10, 1, 5000)}
            {color('color', 'Couleur départ')}
            {color('colorEnd', 'Couleur fin')}
            {num('speed', 'Vitesse', 0.2, 0)}
            {num('lifetime', 'Durée de vie', 0.1, 0.1)}
            {num('spread', 'Dispersion', 0.1, 0)}
            {num('gravity', 'Gravité', 0.5)}
          </>
        )}
        {type === 'terrain' && (
          <>
            {num('sizeX', 'Taille X', 5, 10, 1000)}
            {num('sizeZ', 'Taille Z', 5, 10, 1000)}
            {num('segments', 'Segments', 8, 16, 160)}
            {num('seed', 'Seed', 1, 0, 999999)}
            {num('heightScale', 'Amplitude', 0.5, 0, 50)}
            <label className="block text-gray-300">
              Forme
              <select className="mt-1 w-full rounded bg-gray-800 p-1.5 text-gray-100" value={String(comp.shape)} onChange={(e) => set('shape', e.target.value)}>
                {['hills', 'mountains', 'plains', 'islands'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {color('colorLow', 'Couleur basse')}
            {color('colorHigh', 'Couleur haute')}
          </>
        )}
        {type === 'water' && <>{num('size', 'Taille', 5, 4)}{num('level', 'Niveau', 0.1)}{color('color', 'Couleur')}{num('waveHeight', 'Hauteur des vagues', 0.02, 0)}</>}
        {type === 'sky' && (
          <>
            {num('turbidity', 'Turbidité', 0.5, 1, 20)}
            {num('rayleigh', 'Rayleigh', 0.1, 0, 4)}
            {num('sunElevation', 'Élévation soleil', 0.05, -0.2, 1.6)}
            {num('sunAzimuth', 'Azimut soleil', 0.05, 0, 6.28)}
          </>
        )}
        {type === 'fog' && <>{color('color', 'Couleur')}{num('density', 'Densité', 0.001, 0, 0.2)}</>}
        {type === 'npc' && <NPCEditor comp={comp} set={set} num={num} />}
        {type === 'health' && <>{num('max', 'Max', 5, 1)}{num('current', 'Actuel', 5, 0)}{num('regen', 'Régén/s', 0.5, 0)}</>}
        {type === 'audio' && (
          <>
            <TextureAssetPicker label="Fichier audio" value={String(comp.assetId ?? '')} onChange={(v) => set('assetId', v)} accept="audio" />
            <RangeField label="Volume" value={Number(comp.volume)} onChange={(v) => set('volume', v)} />
            {bool('loop', 'Boucle')}{bool('autoplay', 'Lecture auto')}
          </>
        )}
      </div>
    </div>
  )
}

function CodeBadge() {
  return <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[9px] text-purple-300">sandbox navigateur</span>
}

function NPCEditor({ comp, set, num }: {
  comp: Record<string, unknown>
  set: (k: string, v: unknown) => void
  num: (key: string, label: string, step?: number, min?: number, max?: number) => React.ReactNode
}) {
  return (
    <>
      <label className="block text-gray-300">
        Archétype
        <select className="mt-1 w-full rounded bg-gray-800 p-1.5 text-gray-100" value={String(comp.archetype)} onChange={(e) => set('archetype', e.target.value)}>
          {['civilian', 'guard', 'merchant', 'hostile', 'companion', 'boss'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <TextField label="Personnalité" value={String(comp.personality ?? '')} onChange={(v) => set('personality', v)} />
      <TextField label="Faction" value={String(comp.faction ?? '')} onChange={(v) => set('faction', v)} />
      <TextField label="Profession" value={String(comp.profession ?? '')} onChange={(v) => set('profession', v)} />
      <RangeField label="Agressivité" value={Number(comp.aggression)} onChange={(v) => set('aggression', v)} />
      <RangeField label="Peur" value={Number(comp.fear)} onChange={(v) => set('fear', v)} />
      <RangeField label="Amitié" value={Number(comp.friendliness)} onChange={(v) => set('friendliness', v)} />
      <RangeField label="Curiosité" value={Number(comp.curiosity)} onChange={(v) => set('curiosity', v)} />
      {num('moveSpeed', 'Vitesse', 0.1, 0)}
      {num('sightRange', 'Vision (m)', 1, 1, 100)}
      {num('fovDeg', 'Champ de vision (°)', 5, 30, 360)}
      {num('patrolRadius', 'Rayon de patrouille', 0.5, 1)}
      <TextField
        label="Objectifs (virgules)"
        value={(comp.goals as string[] | undefined)?.join(', ') ?? ''}
        onChange={(v) => set('goals', v.split(',').map((s) => s.trim()).filter(Boolean))}
      />
      <p className="rounded bg-cyan-500/10 p-1.5 text-[10px] text-cyan-300">
        IA hybride: perception → mémoire → utility/behavior tree en local. LLM (dialogue) uniquement à la demande, avec cache + cooldown.
      </p>
    </>
  )
}

function ScriptEditor({ entity, source, enabled, patch }: {
  entity: EntityData; source: string; enabled: boolean; patch: (fn: () => void) => void
}) {
  const doc = useEditor((s) => s.doc)!
  const [error, setError] = useState<string | null>(null)
  const lines = source.split('\n').length

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between text-gray-300">
        Activé
        <Switch
          checked={enabled}
          onCheckedChange={(v) => patch(() => { doc.patchComponent(entity.id, 'script', { enabled: v } as never) })}
        />
      </label>
      <textarea
        className="h-44 w-full resize-y rounded bg-gray-950 p-2 font-mono text-[11px] text-gray-200 outline-none ring-1 ring-gray-800 focus:ring-amber-500/50"
        value={source}
        spellCheck={false}
        onChange={(e) => patch(() => {
          setError(null)
          doc.patchComponent(entity.id, 'script', { source: e.target.value } as never)
        })}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">{lines} lignes · API: ctx.entity, ctx.input, ctx.math, ctx.log</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-6 text-[10px]"
          onClick={async () => {
            try {
              const res = await fetch('/api/ai/assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-project-id': useEditor.getState().projectId ?? '' },
                body: JSON.stringify({
                  mode: 'chat',
                  message: `Améliore ce script de jeu GEN3IA (API: ctx.entity.position, ctx.entity.setPosition, ctx.entity.body.velocity, ctx.input.axis(), ctx.input.key(code), ctx.math.clamp, ctx.log). Script actuel:\n${source}. Réponds UNIQUEMENT avec le code complet amélioré, sans explication.`,
                }),
              })
              const data = await res.json()
              if (data.reply) {
                const cleaned = data.reply.replace(/```[a-z]*|```/g, '').trim()
                patch(() => { doc.patchComponent(entity.id, 'script', { source: cleaned } as never) })
              } else {
                setError(data.error?.message ?? 'Erreur IA')
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Erreur réseau')
            }
          }}
        >
          <Code2 className="mr-1 h-3 w-3" /> IA: améliorer
        </Button>
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}

// ─────────────────── field primitives ───────────────────

function NumField({ label, value, onChange, step = 0.1, min, max }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-gray-300">
      <span className="truncate">{label}</span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-24 bg-gray-800 px-1.5 text-right text-[11px]"
      />
    </label>
  )
}

function Vec3Field({ label, value, onChange }: {
  label: string; value: { x: number; y: number; z: number }; onChange: (v: { x: number; y: number; z: number }) => void
}) {
  const axis = (key: 'x' | 'y' | 'z', accent: string) => (
    <Input
      type="number"
      step={0.1}
      value={value[key]}
      onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
      className={`h-6 w-full bg-gray-800 px-1 text-center text-[11px] ${accent}`}
      aria-label={`${label} ${key}`}
    />
  )
  return (
    <div>
      <span className="text-gray-400">{label}</span>
      <div className="mt-0.5 grid grid-cols-3 gap-1">
        {axis('x', 'text-red-300')}{axis('y', 'text-green-300')}{axis('z', 'text-blue-300')}
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between text-gray-300">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-12 cursor-pointer rounded bg-transparent" aria-label={label} />
    </label>
  )
}

function RangeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="py-0.5">
      <div className="flex items-center justify-between text-gray-300">
        <span>{label}</span>
        <span className="font-mono text-[10px] text-gray-500">{value.toFixed(2)}</span>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={1}
        step={0.01}
        onValueChange={([v]) => onChange(v)}
        className="mt-1"
      />
    </div>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-gray-300">
      {label}
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 h-7 bg-gray-800 text-[11px]" />
    </label>
  )
}

function TextureAssetPicker({ label, value, onChange, accept }: {
  label: string; value: string; onChange: (v: string) => void; accept?: 'audio' | 'image'
}) {
  const assets = useEditor((s) => s.assets)
  const filtered = assets.filter((a) => accept === 'audio' ? a.kind === 'audio' : a.kind === 'texture')
  return (
    <label className="block text-gray-300">
      {label}
      <select
        className="mt-1 w-full rounded bg-gray-800 p-1.5 text-[11px] text-gray-100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— aucun —</option>
        {filtered.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  )
}

function ModelAssetPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const assets = useEditor((s) => s.assets)
  const models = assets.filter((a) => a.kind === 'model')
  return (
    <label className="block text-gray-300">
      Modèle 3D (GLB/glTF)
      <select className="mt-1 w-full rounded bg-gray-800 p-1.5 text-[11px] text-gray-100" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— aucun —</option>
        {models.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  )
}

// tabs export used by shell bottom bar
export { Tabs as InspectorTabs, TabsList, TabsTrigger, TabsContent }
