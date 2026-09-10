// GEN3IA ENGINE — Game runtime. REAL execution of physics, scripts, AI, audio.
// PLAY / PAUSE / STOP / STEP / RESTART. Editor mode restores the original scene state.
import * as THREE from 'three'
import type { EngineRenderer } from './renderer'
import { SceneDoc } from './scene'
import type { EntityData } from './types'
import { PhysicsWorld } from './physics'
import { ScriptHost, type ScriptCtx } from './scripting'
import {
  buildBehaviorTree, createNPCState, perceive, remember, scoreActions, updateEmotion,
  steeringStep, type BTContext, type NPCState, type NPCWorldView,
} from './npc-ai'

export type RuntimeState = 'stopped' | 'playing' | 'paused'

export interface RuntimeStats {
  fps: number
  physicsMs: number
  aiMs: number
  scriptMs: number
  entities: number
  bodies: number
}

export interface RuntimeDeps {
  getAssetUrl: (assetId: string) => string | undefined
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
  onStateChange?: (state: RuntimeState) => void
  onStats?: (stats: RuntimeStats) => void
}

interface EntityRuntime {
  entity: EntityData
  npc?: { brain: NonNullable<EntityData['components']['npc']>; bt: BTContext['state'] extends never ? never : ReturnType<typeof buildBehaviorTree>; state: NPCState; target: THREE.Vector3 }
  audio?: { buffer: AudioBuffer; source?: AudioBufferSourceNode; volume: number; loop: boolean }
  errors: number
}

export class GameRuntime {
  private renderer: EngineRenderer
  private doc: SceneDoc
  private deps: RuntimeDeps
  private physics: PhysicsWorld | null = null
  private scripts = new ScriptHost((lvl, m) => this.deps.log(lvl, m))
  private entitiesRt = new Map<string, EntityRuntime>()
  private state: RuntimeState = 'stopped'
  private accumulator = 0
  private time = 0
  private lastStep = 0
  private snapshotBeforePlay = ''
  // world streaming (cellules): état du gestionnaire de chunks
  private streaming = {
    enabled: false, cellSize: 100, radius: 2,
    currentCell: { cx: 0, cz: 0 },
    cells: new Map<string, string[]>(), // "cx,cz" -> entityIds
    loaded: new Set<string>(),
    lastCheck: 0,
  }
  private keys = new Set<string>()
  private pointer = { x: 0, y: 0, down: false }
  private audioCtx: AudioContext | null = null
  private audioBuffers = new Map<string, AudioBuffer>()
  private statsTimer = 0
  private physicsMs = 0
  private aiMs = 0
  private scriptMs = 0
  private stepOnce = false
  private listeners = new Set<() => void>()
  private collisionForward = new Map<string, Set<string>>() // entityId -> listener script entityIds

  constructor(renderer: EngineRenderer, doc: SceneDoc, deps: RuntimeDeps) {
    this.renderer = renderer
    this.doc = doc
    this.deps = deps
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  // ───────────────── public controls ─────────────────
  play() {
    if (this.state === 'playing') return
    if (this.state === 'paused') {
      this.state = 'playing'
      this.deps.onStateChange?.(this.state)
      return
    }
    this.snapshotBeforePlay = this.doc.toJSON()
    this.setup()
    this.state = 'playing'
    this.renderer.setRunning(true)
    this.deps.onStateChange?.(this.state)
    this.deps.log('info', '▶ Runtime started (physics, scripts, AI active)')
    this.notify()
  }

  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.deps.onStateChange?.(this.state)
    this.deps.log('info', '⏸ Runtime paused')
    this.notify()
  }

  stop() {
    if (this.state === 'stopped') return
    this.teardown()
    if (this.snapshotBeforePlay) {
      SceneDoc.restoreInto(this.doc, this.snapshotBeforePlay)
    }
    this.state = 'stopped'
    this.renderer.setRunning(false)
    this.deps.onStateChange?.(this.state)
    this.deps.log('info', '⏹ Runtime stopped — scene restored')
    this.notify()
  }

  step() {
    if (this.state === 'paused') this.stepOnce = true
  }

  restart() { this.stop(); setTimeout(() => this.play(), 50) }

  getState(): RuntimeState { return this.state }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private notify() { this.listeners.forEach((f) => f()) }

  // ───────────────── setup / teardown ─────────────────
  private setup() {
    this.physics = new PhysicsWorld()
    this.scripts.clear()
    this.entitiesRt.clear()
    this.time = 0
    this.accumulator = 0

    const objects = this.renderer.getObjects()
    for (const [id, rec] of objects) {
      const e = rec.entity
      const rt: EntityRuntime = { entity: e, errors: 0 }

      if (e.components.rigidBody && e.components.collider) {
        const body = this.physics!.addBody(e, rec.built.root)
        void body
      }

      if (e.components.npc) {
        rt.npc = {
          brain: e.components.npc,
          bt: buildBehaviorTree(),
          state: createNPCState(),
          target: new THREE.Vector3(),
        }
      }

      if (e.components.script?.enabled && e.components.script.source.trim()) {
        const res = this.scripts.attach(id, e.components.script.source)
        if (res.ok) {
          this.deps.log('info', `Script attached to "${e.name}"`)
        }
      }

      if (e.components.audio?.assetId) {
        this.loadAudio(id, e)
      }

      this.entitiesRt.set(id, rt)
    }

    this.setupStreaming()

    // script starts
    for (const [id, rt] of this.entitiesRt) {
      if (rt.entity.components.script?.enabled) {
        this.scripts.start(id, this.buildCtx(id, 0))
      }
    }
    this.lastStep = performance.now()
  }

  private teardown() {
    this.physics?.dispose()
    this.physics = null
    this.scripts.clear()
    this.entitiesRt.clear()
    for (const [, rec] of this.renderer.getObjects()) {
      // restore editor transform from doc
      const e = rec.entity
      const t = e.components.transform
      if (t) {
        rec.built.root.position.set(t.position.x, t.position.y, t.position.z)
        rec.built.root.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z)
        rec.built.root.scale.set(t.scale.x, t.scale.y, t.scale.z)
      }
    }
    if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.state !== 'playing') return
    this.keys.add(e.code)
    for (const [id, rt] of this.entitiesRt) {
      if (rt.entity.components.script?.enabled) {
        this.scripts.key(id, this.buildCtx(id, 0), e.code, true)
      }
    }
  }
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
    if (this.state !== 'playing') return
    for (const [id, rt] of this.entitiesRt) {
      if (rt.entity.components.script?.enabled) {
        this.scripts.key(id, this.buildCtx(id, 0), e.code, false)
      }
    }
  }

  setPointer(x: number, y: number, down: boolean) { this.pointer = { x, y, down } }

  // ───────────────── main tick (called from renderer loop owner) ─────────────────
  /** Runs the simulation for `dt` seconds. Call every frame from the viewport host. */
  tick(dt: number) {
    if (this.state === 'playing' || this.stepOnce) {
      const fixed = 1 / 60
      this.accumulator += dt
      let steps = 0
      const t0 = performance.now()
      while (this.accumulator >= fixed && steps < 5) {
        this.simulate(fixed)
        this.accumulator -= fixed
        steps++
      }
      const t1 = performance.now()
      this.physicsMs = this.physicsMs * 0.9 + (t1 - t0) * 0.1
      this.stepOnce = false
    }
    this.statsTimer += dt
    if (this.statsTimer > 0.5) {
      this.statsTimer = 0
      this.deps.onStats?.({
        fps: this.renderer.getStats().fps,
        physicsMs: Math.round(this.physicsMs * 100) / 100,
        aiMs: Math.round(this.aiMs * 100) / 100,
        scriptMs: Math.round(this.scriptMs * 100) / 100,
        entities: this.entitiesRt.size,
        bodies: this.physics ? this.physics.world.bodies.length : 0,
      })
    }
  }

  private simulate(dt: number) {
    this.time += dt
    this.tickStreaming()
    const t0 = performance.now()
    if (this.physics) {
      const objects = new Map<string, THREE.Object3D>()
      for (const [id, rec] of this.renderer.getObjects()) objects.set(id, rec.built.root)
      this.physics.step(dt, objects)
    }
    const t1 = performance.now()

    // NPC AI
    let aiCost = 0
    for (const [id, rt] of this.entitiesRt) {
      if (!rt.npc) continue
      const aiT0 = performance.now()
      this.tickNPC(id, rt, dt)
      aiCost += performance.now() - aiT0
    }
    this.aiMs = this.aiMs * 0.9 + aiCost * 0.1

    // Scripts
    const s0 = performance.now()
    for (const [id, rt] of this.entitiesRt) {
      if (rt.entity.components.script?.enabled) {
        this.scripts.update(id, this.buildCtx(id, dt), dt)
      }
    }
    this.scriptMs = this.scriptMs * 0.9 + (performance.now() - s0) * 0.1
  }

  // ───────────────── NPC brain ─────────────────
  private tickNPC(id: string, rt: EntityRuntime, dt: number) {
    const rec = this.renderer.getObjects().get(id)
    if (!rec || !rt.npc) return
    const obj = rec.built.root
    const brain = rt.npc.brain

    const actors: NPCWorldView['actors'] = []
    const obstacles: NPCWorldView['obstacles'] = []
    for (const [otherId, otherRec] of this.renderer.getObjects()) {
      if (otherId === id) continue
      const isPlayer = otherRec.entity.tags.includes('player') || otherRec.entity.components.player !== undefined
      actors.push({ id: otherId, name: otherRec.entity.name, position: otherRec.built.root.position.clone(), isPlayer, faction: otherRec.entity.tags[0] })
      if (otherRec.entity.components.collider && !isPlayer) {
        const bb = new THREE.Box3().setFromObject(otherRec.built.root)
        const size = bb.getSize(new THREE.Vector3())
        obstacles.push({ position: otherRec.built.root.position.clone(), radius: Math.max(size.x, size.z) / 2 })
      }
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion)
    const perception = perceive(obj.position, forward, brain, {
      actors, obstacles, home: obj.position.clone(), time: this.time,
    })
    const state = rt.npc.state
    updateEmotion(state, brain, perception, this.time)

    if (perception.playerVisible) {
      remember(state, { t: this.time, kind: 'saw_player', position: perception.lastSeenPlayerPos?.clone() }, brain.memoryCapacity)
    }

    const best = scoreActions(brain, state, perception, this.time)[0]
    if (!best) return

    const btCtx: BTContext = {
      state,
      brain,
      perception,
      now: this.time,
      dt,
      home: obj.position.clone(),
      moveTo: (target, speed) => {
        const step = steeringStep(obj.position, target, speed, dt, obstacles)
        step.y = 0
        obj.position.add(step)
        const dir = target.clone().sub(obj.position)
        if (dir.lengthSq() > 0.001) {
          const angle = Math.atan2(dir.x, dir.z)
          obj.rotation.y = angle
        }
      },
      stop: () => {},
      face: (p) => {
        const dir = p.clone().sub(obj.position)
        if (dir.lengthSq() > 0.001) obj.rotation.y = Math.atan2(dir.x, dir.z)
      },
      say: (text) => this.deps.log('info', `[${rt.entity.name}] ${text}`),
      requestDialogue: (playerId) => {
        // Rate-limited LLM dialogue via backend (cache + cooldown server-side)
        const now = Date.now()
        if (now - state.lastLLMDialogueAt < 45000) return false
        state.lastLLMDialogueAt = now
        void this.requestLLMDilogue(rt.entity.name, playerId)
        return true
      },
    }
    rt.npc.bt.tick(btCtx)
  }

  private async requestLLMDilogue(npcName: string, _playerId: string) {
    try {
      const res = await fetch('/api/ai/npc-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcName }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.line) this.deps.log('info', `[${npcName}] ${data.line}`)
      }
    } catch {
      // offline / not logged — NPC stays silent (non-fatal)
    }
  }

  // ───────────────── world streaming (cellules) ─────────────────
  /** Découpe les entités en cellules et charge/décharge selon la position joueur. */
  private setupStreaming() {
    const wc = this.doc.doc.worldConfig
    this.streaming.enabled = Boolean(wc.streamingEnabled)
    if (!this.streaming.enabled) return
    this.streaming.cellSize = wc.cellSize > 0 ? wc.cellSize : 100
    this.streaming.cells.clear()
    this.streaming.loaded.clear()
    for (const [id, rec] of this.renderer.getObjects()) {
      const p = rec.built.root.position
      const cx = Math.floor(p.x / this.streaming.cellSize)
      const cz = Math.floor(p.z / this.streaming.cellSize)
      const key = `${cx},${cz}`
      const list = this.streaming.cells.get(key) ?? []
      list.push(id)
      this.streaming.cells.set(key, list)
    }
    this.updateStreamingCells(true)
    this.deps.log('info', `Streaming du monde actif — ${this.streaming.cells.size} cellules (taille ${this.streaming.cellSize} m, rayon ${this.streaming.radius})`)
  }

  private updateStreamingCells(initial = false) {
    const s = this.streaming
    const objects = this.renderer.getObjects()
    let loadedCount = 0
    let unloadedCount = 0
    for (const [key, ids] of s.cells) {
      const [cx, cz] = key.split(',').map(Number)
      const dist = Math.max(Math.abs(cx - s.currentCell.cx), Math.abs(cz - s.currentCell.cz))
      const shouldLoad = dist <= s.radius
      const isLoaded = s.loaded.has(key)
      if (shouldLoad && !isLoaded) {
        for (const id of ids) {
          const rec = objects.get(id)
          if (rec) rec.built.root.visible = rec.entity.visible !== false
        }
        s.loaded.add(key)
        loadedCount++
      } else if (!shouldLoad && isLoaded) {
        for (const id of ids) {
          const rec = objects.get(id)
          if (rec) rec.built.root.visible = false
        }
        s.loaded.delete(key)
        unloadedCount++
      }
    }
    if (!initial && (loadedCount > 0 || unloadedCount > 0)) {
      this.deps.log('info', `Streaming: +${loadedCount} chunk(s) chargé(s), -${unloadedCount} déchargé(s)`)
    }
  }

  private tickStreaming() {
    if (!this.streaming.enabled) return
    // 4 vérifications/seconde suffisent
    if (this.time - this.streaming.lastCheck < 0.25) return
    this.streaming.lastCheck = this.time
    // entité joueur = premier player spawn, sinon origine
    let px = 0
    let pz = 0
    for (const rt of this.entitiesRt.values()) {
      if (rt.entity.components.player?.isSpawn) {
        const rec = this.renderer.getObjects().get(rt.entity.id)
        if (rec) { px = rec.built.root.position.x; pz = rec.built.root.position.z }
        break
      }
    }
    const cx = Math.floor(px / this.streaming.cellSize)
    const cz = Math.floor(pz / this.streaming.cellSize)
    if (cx !== this.streaming.currentCell.cx || cz !== this.streaming.currentCell.cz) {
      this.streaming.currentCell = { cx, cz }
      this.updateStreamingCells()
    }
  }
  private buildCtx(entityId: string, dt = 0): ScriptCtx {
    const rec = this.renderer.getObjects().get(entityId)
    const obj = rec?.built.root
    const entity = rec?.entity
    const body = this.physics?.bodyOf(entityId)
    const api: ScriptCtx = {
      entity: {
        id: entityId,
        name: entity?.name ?? entityId,
        position: obj ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : { x: 0, y: 0, z: 0 },
        rotation: obj ? { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z } : { x: 0, y: 0, z: 0 },
        scale: obj ? { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z } : { x: 1, y: 1, z: 1 },
        setPosition: (x, y, z) => obj?.position.set(x, y, z),
        rotate: (x, y, z) => { if (obj) { obj.rotation.x += x; obj.rotation.y += y; obj.rotation.z += z } },
        lookAt: (x, y, z) => obj?.lookAt(x, y, z),
        body: body ? {
          get velocity() { return { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z } },
          set velocity(v) { body.velocity.set(v.x, v.y, v.z) },
          quaternion: {
            get x() { return body.quaternion.x },
            get y() { return body.quaternion.y },
            get z() { return body.quaternion.z },
            get w() { return body.quaternion.w },
            set: (x, y, z, w) => body.quaternion.set(x, y, z, w),
            normalize: () => body.quaternion.normalize(),
          },
          applyImpulse: (x, y, z) => body.applyImpulse(new (body.position.constructor as new (x: number, y: number, z: number) => never)(x, y, z) as never, body.position),
          setVelocity: (x, y, z) => body.velocity.set(x, y, z),
        } : null,
        grounded: this.physics?.isGrounded(entityId) ?? false,
        health: entity?.components.health ? { max: entity.components.health.max, current: entity.components.health.current } : null,
        distanceTo: (otherId) => {
          const other = this.renderer.getObjects().get(otherId)
          return other ? obj?.position.distanceTo(other.built.root.position) ?? 0 : 0
        },
        find: (nameOrTag) => this.findEntity(nameOrTag),
      },
      world: {
        time: this.time,
        deltaTime: dt,
        find: (nameOrTag) => this.findEntity(nameOrTag),
        log: (level, msg) => this.deps.log(level, msg),
        on: () => {},
        spawn: () => {},
        destroy: () => {},
      },
      // Alias pratique : ctx.log('message') ou ctx.log('warn', 'message')
      log: (levelOrMsg: string, msg?: string) => {
        const level = (msg !== undefined && ['info', 'warn', 'error'].includes(levelOrMsg)) ? levelOrMsg as 'info' | 'warn' | 'error' : 'info'
        const text = msg !== undefined ? msg : levelOrMsg
        this.deps.log(level, String(text))
      },
      input: {
        key: (code) => this.keys.has(code),
        axis: () => {
          let x = 0, z = 0
          if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1
          if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1
          if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
          if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
          const len = Math.hypot(x, z)
          return len > 0 ? { x: x / len, z: z / len } : { x: 0, z: 0 }
        },
        pointer: () => ({ ...this.pointer }),
      },
      math: {
        clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
        lerp: (a, b, t) => a + (b - a) * t,
        rand: (min, max) => min + Math.random() * (max - min),
        randomInt: (min, max) => Math.floor(min + Math.random() * (max - min + 1)),
        dist: (ax, ay, az, bx, by, bz) => Math.hypot(ax - bx, ay - by, az - bz),
        sin: Math.sin, cos: Math.cos, atan2: Math.atan2, PI: Math.PI,
        Vec3: function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } as never,
      },
    }
    return api
  }

  private findEntity(nameOrTag: string): string | null {
    for (const [id, rt] of this.entitiesRt) {
      if (rt.entity.name === nameOrTag || rt.entity.tags.includes(nameOrTag)) return id
    }
    return null
  }

  // ───────────────── audio (real WebAudio) ─────────────────
  private async loadAudio(entityId: string, e: EntityData) {
    const comp = e.components.audio!
    const url = this.deps.getAssetUrl(comp.assetId)
    if (!url) return
    try {
      this.audioCtx ??= new AudioContext()
      let buffer = this.audioBuffers.get(url)
      if (!buffer) {
        const buf = await fetch(url).then((r) => r.arrayBuffer())
        buffer = await this.audioCtx.decodeAudioData(buf)
        this.audioBuffers.set(url, buffer)
      }
      const rt = this.entitiesRt.get(entityId)
      if (rt) rt.audio = { buffer, volume: comp.volume, loop: comp.loop }
      if (comp.autoplay && rt) this.playAudio(entityId)
    } catch (err) {
      this.deps.log('error', `Audio load failed for ${e.name}: ${err instanceof Error ? err.message : err}`)
    }
  }

  private playAudio(entityId: string) {
    const rt = this.entitiesRt.get(entityId)
    if (!rt?.audio || !this.audioCtx || this.audioCtx.state === 'closed') return
    try {
      const src = this.audioCtx.createBufferSource()
      src.buffer = rt.audio.buffer
      src.loop = rt.audio.loop
      const gain = this.audioCtx.createGain()
      gain.gain.value = rt.audio.volume
      src.connect(gain).connect(this.audioCtx.destination)
      src.start()
      rt.audio.source = src
    } catch (e) {
      this.deps.log('warn', `Audio playback failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.teardown()
    this.listeners.clear()
  }
}
