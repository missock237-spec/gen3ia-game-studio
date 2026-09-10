// GEN3IA ENGINE — Core types for the Entity-Component-System scene graph.
import { z } from 'zod'

export interface Vec3 { x: number; y: number; z: number }
export interface Euler3 { x: number; y: number; z: number } // radians

// ─────────────────────────── Components (data-only) ───────────────────────────

export type MeshKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'capsule' | 'torus' | 'model'

export interface TransformComponent {
  position: Vec3
  rotation: Euler3
  scale: Vec3
}

export interface MeshComponent {
  kind: MeshKind
  params?: Record<string, number>
  /** Asset to load when kind === 'model' (GLB/glTF) */
  assetId?: string
  castShadow: boolean
  receiveShadow: boolean
}

export interface MaterialComponent {
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  opacity: number // 0..1
  wireframe: boolean
  doubleSided: boolean
  textureAssetId?: string
  normalMapAssetId?: string
  normalScale?: number
}

export type LightKind = 'directional' | 'point' | 'spot' | 'ambient' | 'hemisphere'
export interface LightComponent {
  kind: LightKind
  color: string
  intensity: number
  castShadow: boolean
  distance: number // point/spot range
  angle: number // spot cone
  penumbra: number
}

export interface CameraComponent {
  fov: number
  near: number
  far: number
  active: boolean
}

export interface RigidBodyComponent {
  type: 'static' | 'dynamic' | 'kinematic'
  mass: number
  restitution: number
  friction: number
  linearDamping: number
  angularDamping: number
  useGravity: boolean
  freezeRotation: boolean
}

export type ColliderShape = 'box' | 'sphere' | 'cylinder' | 'capsule' | 'mesh'
export interface ColliderComponent {
  shape: ColliderShape
  isTrigger: boolean
  /** half extents override; defaults derived from mesh scale */
  size?: Vec3
  radius?: number
  height?: number
}

export interface CharacterControllerComponent {
  moveSpeed: number
  jumpForce: number
  rotateSpeed: number
  grounded: boolean
}

export interface ScriptComponent {
  source: string
  enabled: boolean
}

export interface AudioComponent {
  assetId: string
  volume: number
  loop: boolean
  autoplay: boolean
}

export interface ParticleEmitterComponent {
  count: number
  color: string
  colorEnd: string
  size: number
  speed: number
  lifetime: number
  spread: number
  gravity: number
  looping: boolean
}

export type TerrainShape = 'hills' | 'mountains' | 'plains' | 'islands'
export interface TerrainComponent {
  sizeX: number
  sizeZ: number
  segments: number
  seed: number
  heightScale: number
  shape: TerrainShape
  colorLow: string
  colorHigh: string
}

export interface WaterComponent {
  size: number
  level: number
  color: string
  waveHeight: number
}

export interface SkyComponent {
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
  sunElevation: number // radians
  sunAzimuth: number
}

export interface FogComponent {
  color: string
  density: number
}

/** Hybrid NPC brain — local (BT/Utility) execution + optional LLM tasks */
export interface NPCComponent {
  archetype: 'civilian' | 'guard' | 'merchant' | 'hostile' | 'companion' | 'boss'
  personality: string
  faction: string
  profession: string
  aggression: number // 0..1
  fear: number // 0..1
  friendliness: number // 0..1
  curiosity: number // 0..1
  moveSpeed: number
  sightRange: number
  fovDeg: number
  hearingRange: number
  goals: string[] // free-form goal descriptions (local utility weights derived)
  patrolRadius: number
  schedule?: string // free-form description
  memoryCapacity: number
  dialoguePrompt?: string // LLM dialogue persona
}

export interface HealthComponent {
  max: number
  current: number
  regen: number
}

export interface InventoryComponent {
  slots: number
  items: Array<{ itemId: string; name: string; quantity: number }>
}

export interface QuestComponent {
  questId: string
  title: string
  description: string
  objectives: Array<{ id: string; text: string; done: boolean }>
  state: 'draft' | 'active' | 'completed'
}

export interface NetworkComponent {
  sync: boolean
  syncRate: number
}

export interface PlayerComponent {
  isSpawn: boolean
}

export interface InteractableComponent {
  prompt: string
  action: string
  range: number
}

export interface TriggerComponent {
  size: Vec3
  once: boolean
  event: string
}

export interface LODComponent {
  /** distances at which entity switches to lower detail: [near, mid, far] */
  levels: number[]
}

export interface WaypointComponent {
  index: number
  loop: boolean
}

// Component type registry keys
export type ComponentType =
  | 'transform' | 'mesh' | 'material' | 'light' | 'camera' | 'rigidBody' | 'collider'
  | 'characterController' | 'script' | 'audio' | 'particleEmitter' | 'terrain' | 'water'
  | 'sky' | 'fog' | 'npc' | 'health' | 'inventory' | 'quest' | 'network' | 'player'
  | 'interactable' | 'trigger' | 'lod' | 'waypoint'

export type ComponentData =
  | TransformComponent | MeshComponent | MaterialComponent | LightComponent | CameraComponent
  | RigidBodyComponent | ColliderComponent | CharacterControllerComponent | ScriptComponent
  | AudioComponent | ParticleEmitterComponent | TerrainComponent | WaterComponent | SkyComponent
  | FogComponent | NPCComponent | HealthComponent | InventoryComponent | QuestComponent
  | NetworkComponent | PlayerComponent | InteractableComponent | TriggerComponent
  | LODComponent | WaypointComponent

export interface EntityData {
  id: string
  name: string
  parentId: string | null
  visible: boolean
  locked: boolean
  tags: string[]
  layer: number
  isStatic: boolean
  prefabOf?: string // prefab source id
  components: ComponentBag
}

/** Strongly-typed component registry: components.mesh is MeshComponent, etc. */
export interface ComponentBag {
  transform?: TransformComponent
  mesh?: MeshComponent
  material?: MaterialComponent
  light?: LightComponent
  camera?: CameraComponent
  rigidBody?: RigidBodyComponent
  collider?: ColliderComponent
  characterController?: CharacterControllerComponent
  script?: ScriptComponent
  audio?: AudioComponent
  particleEmitter?: ParticleEmitterComponent
  terrain?: TerrainComponent
  water?: WaterComponent
  sky?: SkyComponent
  fog?: FogComponent
  npc?: NPCComponent
  health?: HealthComponent
  inventory?: InventoryComponent
  quest?: QuestComponent
  network?: NetworkComponent
  player?: PlayerComponent
  interactable?: InteractableComponent
  trigger?: TriggerComponent
  lod?: LODComponent
  waypoint?: WaypointComponent
}

export interface SceneEnvironment {
  ambientColor: string
  ambientIntensity: number
  shadowsEnabled: boolean
  postProcessing: boolean
}

export interface SceneDocument {
  version: 1
  name: string
  entities: Record<string, EntityData>
  rootOrder: string[]
  environment: SceneEnvironment
  worldConfig: {
    cellSize: number
    streamingEnabled: boolean
    activeCell?: [number, number]
  }
}

// ─────────────────────────── Factories ───────────────────────────

export const DEFAULT_TRANSFORM: TransformComponent = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

export const DEFAULT_MATERIAL: MaterialComponent = {
  color: '#9aa5b1',
  metalness: 0.05,
  roughness: 0.75,
  emissive: '#000000',
  emissiveIntensity: 0,
  opacity: 1,
  wireframe: false,
  doubleSided: false,
}

export const DEFAULT_MESH: MeshComponent = {
  kind: 'box',
  params: { width: 1, height: 1, depth: 1 },
  castShadow: true,
  receiveShadow: true,
}

// ─────────────────────────── Zod schemas (API validation) ───────────────────────────

export const vec3Schema = z.object({
  x: z.number(), y: z.number(), z: z.number(),
})

export const sceneDocumentSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(200),
  entities: z.record(z.string(), z.any()),
  rootOrder: z.array(z.string()),
  environment: z.object({
    ambientColor: z.string(),
    ambientIntensity: z.number().min(0).max(10),
    shadowsEnabled: z.boolean(),
    postProcessing: z.boolean(),
  }),
  worldConfig: z.object({
    cellSize: z.number().positive(),
    streamingEnabled: z.boolean(),
    activeCell: z.tuple([z.number(), z.number()]).optional(),
  }),
})

export type SceneCommand =
  | { op: 'addEntity'; entity: Partial<EntityData> & { name: string } }
  | { op: 'modifyEntity'; entityId: string; patch: Record<string, unknown> }
  | { op: 'deleteEntity'; entityId: string }
  | { op: 'duplicateEntity'; entityId: string; count?: number }
  | { op: 'setEnvironment'; environment: Partial<SceneEnvironment> }

export const sceneCommandSchema: z.ZodType<SceneCommand> = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('addEntity'),
    entity: z.object({ name: z.string().min(1).max(120) }).passthrough(),
  }),
  z.object({
    op: z.literal('modifyEntity'),
    entityId: z.string().min(1),
    patch: z.record(z.string(), z.any()),
  }),
  z.object({ op: z.literal('deleteEntity'), entityId: z.string().min(1) }),
  z.object({ op: z.literal('duplicateEntity'), entityId: z.string().min(1), count: z.number().int().min(1).max(500).optional() }),
  z.object({ op: z.literal('setEnvironment'), environment: z.record(z.string(), z.any()) }),
])

export const aiCommandPayloadSchema = z.object({
  message: z.string().min(1).max(8000),
  sceneSummary: z.string().max(60000).optional(),
})
