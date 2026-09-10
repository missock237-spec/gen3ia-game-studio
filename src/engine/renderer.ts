// GEN3IA ENGINE — Editor viewport (three.js).
// Orbit/FPS cameras, gizmos, selection, grid, snapping, focus, quality modes.
'use client'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { SceneDoc } from './scene'
import type { EntityData } from './types'
import { buildEntityObject, type AssetResolver, type BuiltObject } from './object-build'
import { CullingManager } from './culling'

export type CameraMode = 'orbit' | 'fps'
export type TransformTool = 'translate' | 'rotate' | 'scale'
export type QualityMode = 'performance' | 'balanced' | 'quality'

export interface RendererStats {
  fps: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
}

export interface ViewportOptions {
  onStats?: (s: RendererStats) => void
  onSelect?: (ids: string[]) => void
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void
  deviceKind: 'mobile' | 'tablet' | 'desktop'
}

export class EngineRenderer {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  orbit: OrbitControls
  transformControls: TransformControls
  private canvas: HTMLCanvasElement
  private doc: SceneDoc | null = null
  private objectMap = new Map<string, { built: BuiltObject; entity: EntityData }>()
  private culling = new CullingManager()
  private resolve: AssetResolver = () => undefined
  private raf = 0
  private clock = new THREE.Clock()
  private selection: string[] = []
  private selectionBoxes = new Map<string, THREE.BoxHelper>()
  private grid: THREE.GridHelper
  private axes: THREE.AxesHelper
  private stats: RendererStats = { fps: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 }
  private frames = 0
  private fpsTimer = 0
  private opts: ViewportOptions
  private mode: CameraMode = 'orbit'
  private fpsKeys = new Set<string>()
  private fpsVelocity = new THREE.Vector3()
  private disposed = false
  private snapped = false
  private localSpace = false
  private pendingBuilds = new Set<string>()
  private running = false // set true while game runtime owns the loop
  quality: QualityMode

  constructor(canvas: HTMLCanvasElement, opts: ViewportOptions) {
    this.canvas = canvas
    this.opts = opts
    this.quality = opts.deviceKind === 'mobile' ? 'performance' : opts.deviceKind === 'tablet' ? 'balanced' : 'quality'

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.quality !== 'performance', alpha: false, powerPreference: 'high-performance',
    })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#0d1117')

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
    this.camera.position.set(10, 8, 12)

    this.orbit = new OrbitControls(this.camera, canvas)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.08
    this.orbit.screenSpacePanning = true
    this.orbit.target.set(0, 1, 0)
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }

    this.transformControls = new TransformControls(this.camera, canvas)
    this.transformControls.setMode('translate')
    this.transformControls.setSize(0.9)
    const tc = this.transformControls as unknown as { getHelper?: () => THREE.Object3D }
    const helper: THREE.Object3D = tc.getHelper ? tc.getHelper() : (this.transformControls as unknown as THREE.Object3D)
    this.scene.add(helper)
    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value && this.mode === 'orbit'
    })
    this.transformControls.addEventListener('objectChange', () => this.syncTransformsToDoc())

    this.grid = new THREE.GridHelper(100, 100, 0x334155, 0x1e293b)
    ;(this.grid.material as THREE.Material).transparent = true
    ;(this.grid.material as THREE.Material).opacity = 0.5
    this.scene.add(this.grid)
    this.axes = new THREE.AxesHelper(2)
    this.scene.add(this.axes)

    this.applyQuality()
    window.addEventListener('resize', this.handleResize)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.handleResize()
    this.startLoop()
  }

  // ───────── quality / responsive ─────────
  setQuality(q: QualityMode) { this.quality = q; this.applyQuality() }
  private applyQuality() {
    const dprBase = Math.min(window.devicePixelRatio || 1, this.quality === 'quality' ? 2 : this.quality === 'balanced' ? 1.5 : 1)
    this.renderer.setPixelRatio(dprBase)
    this.renderer.shadowMap.enabled = this.quality !== 'performance' && (this.doc?.doc.environment.shadowsEnabled ?? true)
    this.orbit.enableDamping = true
  }

  handleResize = () => {
    const w = this.canvas.clientWidth || 800
    const h = this.canvas.clientHeight || 600
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  setDocument(doc: SceneDoc, resolve: AssetResolver) {
    this.doc = doc
    this.resolve = resolve
  }

  private syncTransformsToDoc() {
    const obj = this.transformControls.object as THREE.Object3D | undefined
    if (!obj || !this.doc || this.running) return
    const id = obj.userData.entityId as string | undefined
    const rec = id ? this.objectMap.get(id) : undefined
    if (!rec) return
    const t = rec.entity.components.transform
    if (!t) return
    t.position.x = obj.position.x; t.position.y = obj.position.y; t.position.z = obj.position.z
    t.rotation.x = obj.rotation.x; t.rotation.y = obj.rotation.y; t.rotation.z = obj.rotation.z
    t.scale.x = obj.scale.x; t.scale.y = obj.scale.y; t.scale.z = obj.scale.z
  }

  // ───────── document sync (reconciliation) ─────────
  async sync() {
    if (!this.doc) return
    const entities = this.doc.doc.entities
    const seen = new Set<string>()

    for (const entity of Object.values(entities)) {
      seen.add(entity.id)
      let rec = this.objectMap.get(entity.id)
      if (!rec) {
        if (this.pendingBuilds.has(entity.id)) continue
        this.pendingBuilds.add(entity.id)
        buildEntityObject(entity, this.resolve)
          .then((built) => {
            if (this.disposed) { return }
            this.objectMap.set(entity.id, { built, entity })
            this.scene.add(built.root)
            this.culling.register(entity.id, built.root)
            this.pendingBuilds.delete(entity.id)
            this.applyEntityState(entity, built)
          })
          .catch((e) => {
            this.pendingBuilds.delete(entity.id)
            this.opts.onLog?.('error', `Build object ${entity.name}: ${e instanceof Error ? e.message : e}`)
          })
        continue
      }
      // existing: apply state
      rec.entity = entity
      this.applyEntityState(entity, rec.built)
    }
    // removals
    for (const [id, rec] of this.objectMap) {
      if (!seen.has(id)) {
        this.scene.remove(rec.built.root)
        this.disposeObject(rec.built.root)
        this.culling.unregister(id)
        this.objectMap.delete(id)
        const bh = this.selectionBoxes.get(id)
        if (bh) { this.scene.remove(bh); this.selectionBoxes.delete(id) }
      }
    }
    // parents
    for (const [id, rec] of this.objectMap) {
      const parent = entities[rec.entity.parentId ?? '']
      const threeParent = parent ? this.objectMap.get(parent.id)?.built.root : null
      if (threeParent && rec.built.root.parent !== threeParent) threeParent.add(rec.built.root)
      if (!parent && rec.built.root.parent !== this.scene) this.scene.add(rec.built.root)
    }
    // env
    this.scene.fog = null
    for (const e of Object.values(entities)) {
      if (e.components.fog) {
        this.scene.fog = new THREE.FogExp2(e.components.fog.color, e.components.fog.density)
      }
    }
    this.renderer.shadowMap.enabled = this.quality !== 'performance' && this.doc.doc.environment.shadowsEnabled
    this.updateSelectionHelpers()
  }

  private applyEntityState(entity: EntityData, built: BuiltObject) {
    const t = entity.components.transform
    const root = built.root
    if (t) {
      if (!this.transformControls.object || (this.transformControls.object as THREE.Object3D).userData.entityId !== entity.id) {
        root.position.set(t.position.x, t.position.y, t.position.z)
        root.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z)
        root.scale.set(t.scale.x, t.scale.y, t.scale.z)
      }
    }
    root.visible = entity.visible
    root.userData.entityVisible = entity.visible
    root.userData.entityId = entity.id
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat) mat.dispose()
    })
  }

  // ───────── selection & tools ─────────
  setSelection(ids: string[]) {
    this.selection = ids
    const primary = ids.length === 1 ? this.objectMap.get(ids[0])?.built.root : undefined
    const target = primary ?? (ids.length > 1 ? this.objectMap.get(ids[0])?.built.root : undefined)
    if (target && !this.running) {
      this.transformControls.attach(target)
    } else {
      this.transformControls.detach()
    }
    this.updateSelectionHelpers()
  }

  private updateSelectionHelpers() {
    for (const bh of this.selectionBoxes.values()) this.scene.remove(bh)
    this.selectionBoxes.clear()
    for (const id of this.selection) {
      const rec = this.objectMap.get(id)
      if (!rec) continue
      const box = new THREE.BoxHelper(rec.built.root, 0xf59e0b)
      this.selectionBoxes.set(id, box)
      this.scene.add(box)
    }
  }

  setTool(tool: TransformTool) { this.transformControls.setMode(tool) }
  setSnap(on: boolean) {
    this.snapped = on
    if (on) {
      const mode = this.transformControls.getMode()
      this.transformControls.setTranslationSnap(0.5)
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(15))
      this.transformControls.setScaleSnap(0.1)
      void mode
    } else {
      this.transformControls.setTranslationSnap(null)
      this.transformControls.setRotationSnap(null)
      this.transformControls.setScaleSnap(null)
    }
  }
  setLocalSpace(on: boolean) { this.localSpace = on; this.transformControls.setSpace(on ? 'local' : 'world') }
  isSnapped() { return this.snapped }
  isLocalSpace() { return this.localSpace }

  /** Raycast pick from pointer event */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const targets: THREE.Object3D[] = []
    for (const rec of this.objectMap.values()) {
      if (!rec.entity.visible) continue
      // pick mesh children only
      targets.push(rec.built.root)
    }
    const hits = ray.intersectObjects(targets, true)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        if (o.userData.entityId && this.objectMap.has(o.userData.entityId as string)) {
          return o.userData.entityId as string
        }
        o = o.parent
      }
    }
    return null
  }

  focusSelected() {
    const id = this.selection[0]
    const rec = id ? this.objectMap.get(id) : undefined
    if (!rec) return
    const box = new THREE.Box3().setFromObject(rec.built.root)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()
    this.orbit.target.copy(center)
    const dir = new THREE.Vector3().subVectors(this.camera.position, center).normalize()
    if (dir.lengthSq() < 0.001) dir.set(1, 0.8, 1).normalize()
    this.camera.position.copy(center).add(dir.multiplyScalar(Math.max(size * 1.6, 3)))
  }

  frameSelected() {
    const id = this.selection[0]
    const rec = id ? this.objectMap.get(id) : undefined
    if (!rec) return
    const box = new THREE.Box3().setFromObject(rec.built.root)
    const center = box.getCenter(new THREE.Vector3())
    const dist = box.getSize(new THREE.Vector3()).length() * 1.4 + 1
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.orbit.target).normalize()
    this.orbit.target.copy(center)
    this.camera.position.copy(center).add(dir.multiplyScalar(dist))
  }

  // ───────── camera modes ─────────
  setCameraMode(mode: CameraMode) {
    this.mode = mode
    if (mode === 'fps') {
      this.transformControls.detach()
      this.orbit.enabled = false
      this.canvas.requestPointerLock?.()
    } else {
      this.orbit.enabled = true
      if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    }
  }
  cameraMode(): CameraMode { return this.mode }

  private onKeyDown = (e: KeyboardEvent) => {
    this.fpsKeys.add(e.code)
    if (this.mode === 'fps' && document.pointerLockElement === this.canvas) {
      e.preventDefault()
    }
  }
  private onKeyUp = (e: KeyboardEvent) => this.fpsKeys.delete(e.code)

  private updateFpsCamera(dt: number) {
    if (this.mode !== 'fps') return
    const speed = this.fpsKeys.has('ShiftLeft') ? 18 : 8
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const move = new THREE.Vector3()
    if (this.fpsKeys.has('KeyW') || this.fpsKeys.has('ArrowUp')) move.add(forward)
    if (this.fpsKeys.has('KeyS') || this.fpsKeys.has('ArrowDown')) move.sub(forward)
    if (this.fpsKeys.has('KeyD') || this.fpsKeys.has('ArrowRight')) move.add(right)
    if (this.fpsKeys.has('KeyA') || this.fpsKeys.has('ArrowLeft')) move.sub(right)
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt)
      this.fpsVelocity.copy(move)
      this.camera.position.add(move)
    }
  }

  /** touch joystick input for mobile FPS look */
  applyLookDelta(dx: number, dy: number) {
    if (this.mode !== 'fps') return
    const euler = new THREE.Euler(0, 0, 0, 'YXZ')
    euler.setFromQuaternion(this.camera.quaternion)
    euler.y -= dx * 0.005
    euler.x -= dy * 0.005
    euler.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01)
    this.camera.quaternion.setFromEuler(euler)
  }

  applyMoveDelta(x: number, z: number, dt: number) {
    if (this.mode !== 'fps') return
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    forward.y = 0; forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const move = new THREE.Vector3().addScaledVector(forward, z).addScaledVector(right, x)
    if (move.lengthSq() > 0) this.camera.position.add(move.normalize().multiplyScalar(8 * dt))
  }

  // ───────── loop ─────────
  frameHooks = new Set<(dt: number, t: number) => void>()

  private startLoop() {
    const tick = () => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(this.clock.getDelta(), 0.1)
      const t = this.clock.elapsedTime
      for (const hook of this.frameHooks) {
        try { hook(dt, t) } catch (e) {
          this.opts.onLog?.('error', `frame hook: ${e instanceof Error ? e.message : e}`)
          this.frameHooks.delete(hook)
        }
      }
      if (!this.running) {
        this.orbit.update()
        this.updateFpsCamera(dt)
      }
      // built object updaters (water, particles)
      for (const rec of this.objectMap.values()) {
        rec.built.update?.(this.running ? dt : dt, t)
      }
      // culling (frustum + distance + LOD) — PLAY actif ou grandes scènes
      if (this.running || this.objectMap.size > 40) {
        this.culling.update(this.camera, this.camera.position, t)
      }
      for (const bh of this.selectionBoxes.values()) bh.update()
      this.renderer.render(this.scene, this.camera)
      this.collectStats(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private collectStats(dt: number) {
    this.frames++
    this.fpsTimer += dt
    if (this.fpsTimer >= 0.5) {
      const info = this.renderer.info
      this.stats = {
        fps: Math.round(this.frames / this.fpsTimer),
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      }
      this.frames = 0
      this.fpsTimer = 0
      this.opts.onStats?.(this.stats)
    }
  }

  getStats(): RendererStats { return { ...this.stats } }
  setRunning(r: boolean) { this.running = r; this.orbit.enabled = !r && this.mode === 'orbit' }
  getObjects(): Map<string, { built: BuiltObject; entity: EntityData }> { return this.objectMap }
  getResolver(): AssetResolver { return this.resolve }
  markDirty() { this.applyQuality() }
  gridVisible(v: boolean) { this.grid.visible = v; this.axes.visible = v }

  /** Stats de culling (Phase 15) — exposées au profiler. */
  getCullingStats() { return this.culling.getStats() }

  /** Configuration culling (maxDistance 0 = infini, LOD on/off). */
  setCullingConfig(cfg: { maxDistance?: number; lodEnabled?: boolean; lodDistances?: [number, number] }) {
    this.culling.setConfig(cfg)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.handleResize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.transformControls.dispose()
    this.orbit.dispose()
    for (const rec of this.objectMap.values()) this.disposeObject(rec.built.root)
    this.objectMap.clear()
    this.culling.clear()
    this.renderer.dispose()
  }
}
