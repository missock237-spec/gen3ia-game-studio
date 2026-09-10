// GEN3IA ENGINE — Scene graph (ECS document) with command history, parenting, duplication.
import type {
  ComponentBag, ComponentData, ComponentType, EntityData, SceneDocument, SceneEnvironment,
} from './types'
import { DEFAULT_MATERIAL, DEFAULT_MESH, DEFAULT_TRANSFORM } from './types'

let idCounter = 0
export function genId(prefix = 'e'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

interface Command {
  label: string
  undo(): void
  redo(): void
}

export class SceneDoc {
  doc: SceneDocument
  private history: Command[] = []
  private future: Command[] = []
  private listeners = new Set<() => void>()

  constructor(name = 'Untitled Scene') {
    this.doc = {
      version: 1,
      name,
      entities: {},
      rootOrder: [],
      environment: {
        ambientColor: '#8899bb',
        ambientIntensity: 0.55,
        shadowsEnabled: true,
        postProcessing: true,
      },
      worldConfig: { cellSize: 100, streamingEnabled: false },
    }
  }

  // ── Observability ──
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() { this.listeners.forEach((l) => l()) }
  private push(cmd: Command) {
    this.history.push(cmd)
    if (this.history.length > 200) this.history.shift()
    this.future = []
  }

  canUndo(): boolean { return this.history.length > 0 }
  canRedo(): boolean { return this.future.length > 0 }
  undo(): boolean {
    const cmd = this.history.pop()
    if (!cmd) return false
    cmd.undo()
    this.future.push(cmd)
    this.emit()
    return true
  }
  redo(): boolean {
    const cmd = this.future.pop()
    if (!cmd) return false
    cmd.redo()
    this.history.push(cmd)
    this.emit()
    return true
  }

  // ── Entities ──
  createEntity(name: string, parentId: string | null = null, components: ComponentBag = {}): EntityData {
    const entity: EntityData = {
      id: genId(),
      name: this.uniqueName(name),
      parentId,
      visible: true,
      locked: false,
      tags: [],
      layer: 0,
      isStatic: false,
      components: {
        transform: { ...DEFAULT_TRANSFORM, position: { ...DEFAULT_TRANSFORM.position }, rotation: { ...DEFAULT_TRANSFORM.rotation }, scale: { ...DEFAULT_TRANSFORM.scale } },
        ...components,
      },
    }
    const parentIdAtCreation = parentId
    this.doc.entities[entity.id] = entity
    if (!parentIdAtCreation) this.doc.rootOrder.push(entity.id)
    this.push({
      label: `Add ${entity.name}`,
      undo: () => this.removeEntityInternal(entity.id),
      redo: () => {
        this.doc.entities[entity.id] = entity
        if (!parentIdAtCreation) this.doc.rootOrder.push(entity.id)
      },
    })
    this.emit()
    return entity
  }

  private removeEntityInternal(id: string): void {
    delete this.doc.entities[id]
    this.doc.rootOrder = this.doc.rootOrder.filter((x) => x !== id)
  }

  createPrimitive(kind: 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'capsule' | 'torus', name?: string): EntityData {
    const params: Record<string, number> =
      kind === 'box' ? { width: 1, height: 1, depth: 1 }
      : kind === 'sphere' ? { radius: 0.5 }
      : kind === 'cylinder' ? { radiusTop: 0.5, radiusBottom: 0.5, height: 1 }
      : kind === 'cone' ? { radius: 0.5, height: 1 }
      : kind === 'plane' ? { width: 4, height: 4 }
      : kind === 'capsule' ? { radius: 0.4, length: 0.8 }
      : { radius: 0.5, tube: 0.2 }
    const mesh = { ...DEFAULT_MESH, kind, params }
    const entity = this.createEntity(name ?? kind, null, { mesh, material: { ...DEFAULT_MATERIAL } })
    if (kind !== 'plane') entity.components.transform!.position.y = 0.6
    return entity
  }

  get(id: string): EntityData | undefined { return this.doc.entities[id] }

  children(id: string | null): EntityData[] {
    if (!id) return this.doc.rootOrder.map((eid) => this.doc.entities[eid]).filter(Boolean)
    return Object.values(this.doc.entities).filter((e) => e.parentId === id)
  }

  ancestors(id: string): EntityData[] {
    const out: EntityData[] = []
    let cur = this.get(id)?.parentId
    while (cur) {
      const p = this.get(cur)
      if (!p) break
      out.push(p)
      cur = p.parentId
    }
    return out
  }

  reparent(entityId: string, newParentId: string | null): boolean {
    if (entityId === newParentId) return false
    // prevent cycles
    let p = newParentId
    while (p) { if (p === entityId) return false; p = this.get(p)?.parentId ?? null }
    const e = this.get(entityId)
    if (!e) return false
    const oldParent = e.parentId
    const wasRoot = !oldParent
    e.parentId = newParentId
    if (wasRoot) this.doc.rootOrder = this.doc.rootOrder.filter((x) => x !== entityId)
    if (!newParentId) this.doc.rootOrder.push(entityId)
    this.push({
      label: `Reparent ${e.name}`,
      undo: () => {
        const ent = this.get(entityId); if (!ent) return
        ent.parentId = oldParent
        if (!newParentId) this.doc.rootOrder = this.doc.rootOrder.filter((x) => x !== entityId)
        if (!oldParent) this.doc.rootOrder.push(entityId)
      },
      redo: () => {
        const ent = this.get(entityId); if (!ent) return
        ent.parentId = newParentId
        if (!oldParent) this.doc.rootOrder = this.doc.rootOrder.filter((x) => x !== entityId)
        if (!newParentId) this.doc.rootOrder.push(entityId)
      },
    })
    this.emit()
    return true
  }

  deleteEntity(id: string): boolean {
    const e = this.get(id)
    if (!e) return false
    const subtree = this.descendants(id).concat(e)
    const snapshot = subtree.map((x) => ({ data: x, parent: x.parentId, rootIdx: this.doc.rootOrder.indexOf(x.id) }))
    for (const s of subtree) {
      delete this.doc.entities[s.id]
      this.doc.rootOrder = this.doc.rootOrder.filter((x) => x !== s.id)
    }
    this.push({
      label: `Delete ${e.name}`,
      undo: () => {
        for (const s of snapshot) {
          this.doc.entities[s.data.id] = s.data
          if (!s.parent) this.doc.rootOrder.push(s.data.id)
        }
      },
      redo: () => {
        for (const s of snapshot) {
          delete this.doc.entities[s.data.id]
          this.doc.rootOrder = this.doc.rootOrder.filter((x) => x !== s.data.id)
        }
      },
    })
    this.emit()
    return true
  }

  descendants(id: string): EntityData[] {
    const out: EntityData[] = []
    const walk = (pid: string) => {
      for (const e of Object.values(this.doc.entities)) {
        if (e.parentId === pid) { out.push(e); walk(e.id) }
      }
    }
    walk(id)
    return out
  }

  duplicateEntity(id: string, count = 1): EntityData[] {
    const out: EntityData[] = []
    for (let i = 0; i < count; i++) {
      const created: EntityData[] = []
      const copy = (srcId: string, parentId: string | null) => {
        const src = this.get(srcId)
        if (!src) return
        const clone: EntityData = JSON.parse(JSON.stringify(src))
        clone.id = genId()
        clone.parentId = parentId
        clone.name = this.uniqueName(count > 1 ? `${src.name}_${i + 1}` : `${src.name}_copy`)
        this.doc.entities[clone.id] = clone
        created.push(clone)
        if (!parentId && this.doc.rootOrder.indexOf(clone.id) < 0) this.doc.rootOrder.push(clone.id)
        for (const child of this.children(srcId)) copy(child.id, clone.id)
      }
      copy(id, this.get(id)?.parentId ?? null)
      out.push(...created)
    }
    // offset top-level duplicates so they don't overlap
    const t = this.get(out[0]?.id)
    if (t?.components.transform) {
      t.components.transform.position.x += 1.2 * count
    }
    const created = out
    this.push({
      label: 'Duplicate',
      undo: () => { for (const c of created) { delete this.doc.entities[c.id]; this.doc.rootOrder = this.doc.rootOrder.filter((x) => x !== c.id) } },
      redo: () => { for (const c of created) { this.doc.entities[c.id] = c; if (!c.parentId) this.doc.rootOrder.push(c.id) } },
    })
    this.emit()
    return out
  }

  patchEntity(id: string, patch: Partial<EntityData>, label = 'Edit'): boolean {
    const e = this.get(id)
    if (!e) return false
    const before = JSON.stringify({ name: e.name, visible: e.visible, locked: e.locked, tags: e.tags, layer: e.layer, isStatic: e.isStatic })
    const apply = (data: string) => {
      const v = JSON.parse(data)
      Object.assign(e, v)
    }
    const after = JSON.stringify({ ...JSON.parse(before), ...patch })
    apply(after)
    this.push({ label, undo: () => apply(before), redo: () => apply(after) })
    this.emit()
    return true
  }

  patchComponent<C extends ComponentType>(entityId: string, type: C, patch: Partial<ComponentData>, label = `Edit ${type}`): boolean {
    const e = this.get(entityId)
    if (!e) return false
    if (!e.components[type]) return false
    const before = JSON.stringify(e.components[type])
    const comp = e.components[type] as unknown as Record<string, unknown>
    Object.assign(comp, patch)
    const after = JSON.stringify(e.components[type])
    this.push({
      label,
      undo: () => { const ent = this.get(entityId); if (ent?.components[type]) (ent.components as Record<string, unknown>)[type] = JSON.parse(before) },
      redo: () => { const ent = this.get(entityId); if (ent?.components[type]) (ent.components as Record<string, unknown>)[type] = JSON.parse(after) },
    })
    this.emit()
    return true
  }

  addComponent(entityId: string, type: ComponentType, data: ComponentData): boolean {
    const e = this.get(entityId)
    if (!e || e.components[type]) return false
    ;(e.components as Record<string, unknown>)[type] = data
    this.push({
      label: `Add ${type}`,
      undo: () => { const ent = this.get(entityId); if (ent) delete (ent.components as Record<string, unknown>)[type] },
      redo: () => { const ent = this.get(entityId); if (ent) (ent.components as Record<string, unknown>)[type] = data },
    })
    this.emit()
    return true
  }

  removeComponent(entityId: string, type: ComponentType): boolean {
    const e = this.get(entityId)
    if (!e || !e.components[type]) return false
    const data = e.components[type]
    delete (e.components as Record<string, unknown>)[type]
    this.push({
      label: `Remove ${type}`,
      undo: () => { const ent = this.get(entityId); if (ent) (ent.components as Record<string, unknown>)[type] = data },
      redo: () => { const ent = this.get(entityId); if (ent) delete (ent.components as Record<string, unknown>)[type] },
    })
    this.emit()
    return true
  }

  setEnvironment(patch: Partial<SceneEnvironment>): void {
    const before = { ...this.doc.environment }
    Object.assign(this.doc.environment, patch)
    const after = { ...this.doc.environment }
    this.push({
      label: 'Environment',
      undo: () => { this.doc.environment = before },
      redo: () => { this.doc.environment = after },
    })
    this.emit()
  }

  uniqueName(base: string): string {
    const names = new Set(Object.values(this.doc.entities).map((e) => e.name))
    if (!names.has(base)) return base
    let i = 2
    while (names.has(`${base} (${i})`)) i++
    return `${base} (${i})`
  }

  // ── (De)serialization ──
  static fromJSON(json: string | Partial<SceneDocument>): SceneDoc {
    const d = new SceneDoc()
    if (!json) return d
    const raw = typeof json === 'string' ? JSON.parse(json) : json
    if (raw && raw.version === 1) {
      d.doc = {
        version: 1,
        name: raw.name ?? 'Scene',
        entities: raw.entities ?? {},
        rootOrder: (raw.rootOrder ?? []).filter((id: string) => raw.entities?.[id]),
        environment: { ...d.doc.environment, ...(raw.environment ?? {}) },
        worldConfig: { ...d.doc.worldConfig, ...(raw.worldConfig ?? {}) },
      }
    }
    return d
  }

  /** Replace the content of this SceneDoc in place (used to restore after play mode). */
  static restoreInto(target: SceneDoc, json: string): void {
    const raw = typeof json === 'string' ? JSON.parse(json) : json
    if (!raw || raw.version !== 1) return
    target.doc = {
      version: 1,
      name: raw.name ?? target.doc.name,
      entities: raw.entities ?? {},
      rootOrder: (raw.rootOrder ?? []).filter((id: string) => raw.entities?.[id]),
      environment: { ...target.doc.environment, ...(raw.environment ?? {}) },
      worldConfig: { ...target.doc.worldConfig, ...(raw.worldConfig ?? {}) },
    }
    target.clearHistory()
    target.emit()
  }

  clearHistory(): void {
    this.history = []
    this.future = []
  }

  toJSON(): string { return JSON.stringify(this.doc) }

  summary(): string {
    const entities = Object.values(this.doc.entities)
    const byKind = new Map<string, number>()
    for (const e of entities) {
      const kind = e.components.mesh ? String(e.components.mesh.kind) : e.components.light ? 'light' : e.components.terrain ? 'terrain' : 'empty'
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
    }
    const parts = [...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(', ')
    return `Scene "${this.doc.name}": ${entities.length} entities (${parts || 'empty'})`
  }
}

// ─────────────────────────── Starter scene (real, playable) ───────────────────────────

export function createStarterScene(): SceneDoc {
  const s = new SceneDoc('Main Scene')

  // Ground
  const ground = s.createEntity('Ground')
  ground.components.mesh = { kind: 'box', params: { width: 40, height: 1, depth: 40 }, castShadow: true, receiveShadow: true }
  ground.components.material = { ...DEFAULT_MATERIAL, color: '#3f7a4e', roughness: 0.9 }
  ground.components.rigidBody = { type: 'static', mass: 0, restitution: 0.1, friction: 0.8, linearDamping: 0, angularDamping: 0, useGravity: false, freezeRotation: true }
  ground.components.collider = { shape: 'box', isTrigger: false }
  ground.components.transform!.position = { x: 0, y: -0.5, z: 0 }

  // Player spawn (playable capsule with controller + camera follow target)
  const player = s.createEntity('Player')
  player.tags = ['player']
  player.components.mesh = { kind: 'capsule', params: { radius: 0.4, length: 0.8 }, castShadow: true, receiveShadow: true }
  player.components.material = { ...DEFAULT_MATERIAL, color: '#e8b13c', metalness: 0.3, roughness: 0.4 }
  player.components.rigidBody = { type: 'dynamic', mass: 70, restitution: 0, friction: 0.4, linearDamping: 0.05, angularDamping: 1, useGravity: true, freezeRotation: true }
  player.components.collider = { shape: 'capsule', isTrigger: false, radius: 0.4, height: 1.4 }
  player.components.characterController = { moveSpeed: 6, jumpForce: 7, rotateSpeed: 12, grounded: false }
  player.components.player = { isSpawn: true }
  player.components.health = { max: 100, current: 100, regen: 1 }
  player.components.transform!.position = { x: 0, y: 2, z: 4 }
  player.components.script = {
    enabled: true,
    source: `// Player controller — runs in PLAY mode (WASD/arrows + Space)
function onStart(ctx) {
  ctx.log("Player ready — WASD/arrows to move, Space to jump")
}

function onUpdate(ctx, dt) {
  const speed = 6
  const dir = ctx.input.axis()          // {x, z} normalized movement
  const body = ctx.entity.body
  if (body) {
    body.velocity.x = dir.x * speed
    body.velocity.z = dir.z * speed
    if (ctx.input.key(' ') && ctx.entity.grounded) {
      body.velocity.y = 7
    }
  }
  // keep upright
  if (body) { body.quaternion.set(0, body.quaternion.y, 0, body.quaternion.w); body.quaternion.normalize() }
}
`,
  }

  // Some blocks to interact with
  for (let i = 0; i < 6; i++) {
    const crate = s.createEntity(`Crate ${i + 1}`)
    crate.components.mesh = { kind: 'box', params: { width: 1, height: 1, depth: 1 }, castShadow: true, receiveShadow: true }
    crate.components.material = { ...DEFAULT_MATERIAL, color: ['#b4653a', '#7a9e5f', '#5f7a9e', '#9e5f7a', '#b4a03a', '#7a5f9e'][i] }
    crate.components.rigidBody = { type: 'dynamic', mass: 8, restitution: 0.3, friction: 0.6, linearDamping: 0.01, angularDamping: 0.05, useGravity: true, freezeRotation: false }
    crate.components.collider = { shape: 'box', isTrigger: false }
    crate.components.transform!.position = { x: -3 + i * 1.2, y: 1.5 + i * 1.3, z: -3 }
    crate.components.transform!.rotation = { x: 0, y: i * 0.4, z: 0 }
  }

  // NPC
  const npc = s.createEntity('Villager')
  npc.tags = ['npc']
  npc.components.mesh = { kind: 'capsule', params: { radius: 0.4, length: 0.9 }, castShadow: true, receiveShadow: true }
  npc.components.material = { ...DEFAULT_MATERIAL, color: '#7ec8e3', roughness: 0.6 }
  npc.components.npc = {
    archetype: 'civilian',
    personality: 'Curieux et bavard',
    faction: 'Village',
    profession: 'Fermier',
    aggression: 0.05,
    fear: 0.35,
    friendliness: 0.8,
    curiosity: 0.7,
    moveSpeed: 2.5,
    sightRange: 18,
    fovDeg: 150,
    hearingRange: 10,
    goals: ['patrol', 'greet player'],
    patrolRadius: 6,
    memoryCapacity: 20,
  }
  npc.components.health = { max: 50, current: 50, regen: 0 }
  npc.components.transform!.position = { x: 4, y: 1.2, z: 0 }

  // Ramp + platform
  const ramp = s.createEntity('Ramp')
  ramp.components.mesh = { kind: 'box', params: { width: 4, height: 0.3, depth: 8 }, castShadow: true, receiveShadow: true }
  ramp.components.material = { ...DEFAULT_MATERIAL, color: '#8d7355' }
  ramp.components.rigidBody = { type: 'static', mass: 0, restitution: 0.1, friction: 0.9, linearDamping: 0, angularDamping: 0, useGravity: false, freezeRotation: true }
  ramp.components.collider = { shape: 'box', isTrigger: false }
  ramp.components.transform!.position = { x: -6, y: 0.9, z: 4 }
  ramp.components.transform!.rotation = { x: -0.35, y: 0, z: 0 }

  const platform = s.createEntity('Platform')
  platform.components.mesh = { kind: 'box', params: { width: 6, height: 0.4, depth: 6 }, castShadow: true, receiveShadow: true }
  platform.components.material = { ...DEFAULT_MATERIAL, color: '#6b7f96', metalness: 0.4, roughness: 0.5 }
  platform.components.rigidBody = { type: 'static', mass: 0, restitution: 0.1, friction: 0.9, linearDamping: 0, angularDamping: 0, useGravity: false, freezeRotation: true }
  platform.components.collider = { shape: 'box', isTrigger: false }
  platform.components.transform!.position = { x: -9, y: 2.6, z: 8 }

  // Lights
  const sun = s.createEntity('Sun')
  sun.components.light = { kind: 'directional', color: '#fff4e0', intensity: 2.6, castShadow: true, distance: 0, angle: 0, penumbra: 0 }
  sun.components.transform!.position = { x: 12, y: 18, z: 8 }
  sun.components.transform!.rotation = { x: -0.9, y: 0.6, z: 0 }

  const ambient = s.createEntity('Ambient Light')
  ambient.components.light = { kind: 'ambient', color: '#8899bb', intensity: 0.5, castShadow: false, distance: 0, angle: 0, penumbra: 0 }

  const torch = s.createEntity('Torch')
  torch.components.mesh = { kind: 'cylinder', params: { radiusTop: 0.08, radiusBottom: 0.12, height: 1.6 }, castShadow: true, receiveShadow: true }
  torch.components.material = { ...DEFAULT_MATERIAL, color: '#6b4a2f', roughness: 0.9 }
  torch.components.light = { kind: 'point', color: '#ff9a3c', intensity: 12, castShadow: false, distance: 14, angle: 0, penumbra: 0.4 }
  torch.components.transform!.position = { x: 5, y: 1.6, z: 5 }

  const torchLight = s.createEntity('Torch Light', torch.id)
  torchLight.components.light = { kind: 'point', color: '#ff9a3c', intensity: 14, castShadow: false, distance: 16, angle: 0, penumbra: 0.5 }
  torchLight.components.transform!.position = { x: 0, y: 1, z: 0 }

  // Sky
  const sky = s.createEntity('Sky')
  sky.components.sky = { turbidity: 6, rayleigh: 1.6, mieCoefficient: 0.005, mieDirectionalG: 0.8, sunElevation: 0.9, sunAzimuth: 0.6 }

  // Fog attached to scene environment
  const fog = s.createEntity('Fog')
  fog.components.fog = { color: '#aac4e0', density: 0.006 }

  // Emitter demo
  const fountain = s.createEntity('Fountain')
  fountain.components.mesh = { kind: 'cylinder', params: { radiusTop: 0.9, radiusBottom: 1.1, height: 0.5 }, castShadow: true, receiveShadow: true }
  fountain.components.material = { ...DEFAULT_MATERIAL, color: '#7d8a99', roughness: 0.4, metalness: 0.3 }
  fountain.components.particleEmitter = {
    count: 120, color: '#9fd8ff', colorEnd: '#3b82a0', size: 0.09,
    speed: 3.4, lifetime: 1.4, spread: 0.5, gravity: -6, looping: true,
  }
  fountain.components.transform!.position = { x: 5, y: 0.3, z: 5 }

  return s
}
