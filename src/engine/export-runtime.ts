// GEN3IA — Export runtime: browser entry point for standalone exported games.
// This module is bundled with esbuild by the Build Orchestrator into a fully
// self-contained playable game (no editor, no server needed).
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { compileScript } from './scripting'
import {
  perceive, remember, scoreActions, updateEmotion, steeringStep, createNPCState,
  type BTContext, type NPCState,
} from './npc-ai'
import { buildEntityObject, buildTerrainGeometry } from './object-build'
import type { EntityData, SceneDocument } from './types'

interface ExportConfig {
  scene: SceneDocument
  quality: 'performance' | 'balanced' | 'quality'
}

declare global {
  interface Window {
    __GEN3IA_EXPORT__?: ExportConfig
  }
}

interface ExportRt {
  entity: EntityData
  obj: THREE.Object3D
  body?: CANNON.Body
  npc?: { brain: NonNullable<EntityData['components']['npc']>; state: NPCState }
  hooks?: { onStart?: (ctx: unknown) => void; onUpdate?: (ctx: unknown, dt: number) => void; onCollision?: (ctx: unknown, other: { entityId: string; name: string }) => void }
  errors: number
}

async function boot() {
  const config = window.__GEN3IA_EXPORT__
  if (!config) {
    document.body.innerHTML = '<p style="color:#fff;font-family:sans-serif">Export corrompu : scène manquante.</p>'
    return
  }

  const canvas = document.getElementById('game') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: config.quality !== 'performance' })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.quality === 'quality' ? 2 : 1.4))
  renderer.shadowMap.enabled = config.quality !== 'performance' && config.scene.environment.shadowsEnabled
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0d1117')
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000)
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  // ambient + fog
  scene.add(new THREE.AmbientLight(new THREE.Color(config.scene.environment.ambientColor), config.scene.environment.ambientIntensity))
  const findComponent = <T>(pred: (e: EntityData) => boolean) => Object.values(config!.scene.entities).find(pred)

  const fogEntity = Object.values(config.scene.entities).find((e) => e.components.fog)
  if (fogEntity?.components.fog) scene.fog = new THREE.FogExp2(fogEntity.components.fog.color, fogEntity.components.fog.density)

  const keys = new Set<string>()
  window.addEventListener('keydown', (e) => keys.add(e.code))
  window.addEventListener('keyup', (e) => keys.delete(e.code))

  // physics world
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })
  world.broadphase = new CANNON.SAPBroadphase(world)

  const rts: ExportRt[] = []
  const logEl = document.getElementById('boot-log') as HTMLElement | null

  for (const entity of Object.values(config.scene.entities)) {
    const built = await buildEntityObject(entity, () => undefined)
    scene.add(built.root)
    const rt: ExportRt = { entity, obj: built.root, errors: 0 }

    // parent
    if (entity.parentId) {
      const parent = rts.find((r) => r.entity.id === entity.parentId)
      if (parent) parent.obj.add(built.root)
    }

    // physics body
    if (entity.components.rigidBody && entity.components.collider) {
      const rb = entity.components.rigidBody
      const mesh = entity.components.mesh
      let shape: CANNON.Shape
      if (entity.components.collider.shape === 'sphere') {
        shape = new CANNON.Sphere(entity.components.collider.radius ?? 0.5)
      } else if (mesh?.kind === 'capsule') {
        shape = new CANNON.Cylinder(entity.components.collider.radius ?? 0.4, entity.components.collider.radius ?? 0.4, (entity.components.collider.height ?? 1.2) + 2 * (entity.components.collider.radius ?? 0.4), 12)
      } else {
        const p = mesh?.params ?? {}
        shape = new CANNON.Box(new CANNON.Vec3((p.width ?? 1) / 2, (p.height ?? 1) / 2, (p.depth ?? 1) / 2))
      }
      const body = new CANNON.Body({
        mass: rb.type === 'dynamic' ? Math.max(0.001, rb.mass) : 0,
        shape,
        position: new CANNON.Vec3(built.root.position.x, built.root.position.y, built.root.position.z),
        linearDamping: rb.linearDamping,
        angularDamping: rb.angularDamping,
      })
      body.quaternion.setFromEuler(built.root.rotation.x, built.root.rotation.y, built.root.rotation.z)
      if (rb.freezeRotation) body.angularFactor.set(0, 0, 0)
      world.addBody(body)
      rt.body = body
    }

    if (entity.components.npc) {
      rt.npc = { brain: entity.components.npc, state: createNPCState() }
    }

    if (entity.components.script?.enabled && entity.components.script.source.trim()) {
      try {
         
        const factory = new Function('"use strict";\n' + entity.components.script.source + '\n;return { onStart: typeof onStart === "function" ? onStart : null, onUpdate: typeof onUpdate === "function" ? onUpdate : null, onCollision: typeof onCollision === "function" ? onCollision : null };')
        rt.hooks = factory()
      } catch (e) {
        console.error(`Script error in ${entity.name}:`, e)
      }
    }
    rts.push(rt)
    if (logEl) logEl.textContent = entity.name
  }
  if (logEl) logEl.parentElement?.remove()

  // camera follow the first player spawn
  const playerRt = rts.find((r) => r.entity.components.player) ?? rts[0]
  const followTarget = playerRt?.obj ?? new THREE.Object3D()
  let yaw = 0, pitch = 0.35
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement) {
      yaw -= e.movementX * 0.0025
      pitch = Math.max(-0.2, Math.min(1.2, pitch + e.movementY * 0.002))
    }
  })
  canvas.addEventListener('click', () => canvas.requestPointerLock?.())

  const buildCtx = (rt: ExportRt) => ({
    entity: {
      id: rt.entity.id,
      name: rt.entity.name,
      position: rt.obj.position,
      rotation: rt.obj.rotation,
      scale: rt.obj.scale,
      setPosition: (x: number, y: number, z: number) => rt.obj.position.set(x, y, z),
      rotate: (x: number, y: number, z: number) => rt.obj.rotation.set(rt.obj.rotation.x + x, rt.obj.rotation.y + y, rt.obj.rotation.z + z),
      lookAt: (x: number, y: number, z: number) => rt.obj.lookAt(x, y, z),
      body: rt.body ? { velocity: rt.body.velocity, quaternion: rt.body.quaternion, applyImpulse: (x: number, y: number, z: number) => rt.body!.applyImpulse(new CANNON.Vec3(x, y, z), rt.body!.position), setVelocity: (x: number, y: number, z: number) => rt.body!.velocity.set(x, y, z) } : null,
      grounded: false,
      health: rt.entity.components.health ? { max: rt.entity.components.health.max, current: rt.entity.components.health.current } : null,
      distanceTo: () => 0,
      find: (n: string) => rts.find((r) => r.entity.name === n || r.entity.tags.includes(n))?.entity.id ?? null,
    },
    world: { time: 0, deltaTime: 0, find: () => null, log: (l: string, m: string) => console[l](m), on: () => {}, spawn: () => {}, destroy: () => {} },
    log: (levelOrMsg: string, msg?: string) => {
      const level = (msg !== undefined && ['info', 'warn', 'error'].includes(levelOrMsg)) ? levelOrMsg as 'info' | 'warn' | 'error' : 'info'
      const text = msg !== undefined ? msg : levelOrMsg
      console[level](text)
    },
    input: {
      key: (code: string) => keys.has(code),
      axis: () => {
        let x = 0, z = 0
        if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1
        if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1
        if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1
        if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1
        const len = Math.hypot(x, z)
        return len ? { x: x / len, z: z / len } : { x: 0, z: 0 }
      },
      pointer: () => ({ x: 0, y: 0, down: document.pointerLockElement !== null }),
    },
    math: { clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)), lerp: (a: number, b: number, t: number) => a + (b - a) * t, rand: (a: number, b: number) => a + Math.random() * (b - a), randomInt: (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1)), dist: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => Math.hypot(ax - bx, ay - by, az - bz), sin: Math.sin, cos: Math.cos, atan2: Math.atan2, PI: Math.PI, Vec3: Object },
  })

  for (const rt of rts) {
    if (rt.hooks?.onStart) {
      try { (rt.hooks.onStart as (c: unknown) => void)(buildCtx(rt)) } catch (e) { console.error(e) }
    }
  }

  let time = 0
  let last = performance.now()
  const loop = () => {
    requestAnimationFrame(loop)
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    time += dt

    world.step(1 / 60, dt, 3)
    for (const rt of rts) {
      if (rt.body) {
        rt.obj.position.set(rt.body.position.x, rt.body.position.y, rt.body.position.z)
      }
    }

    // NPC AI
    for (const rt of rts) {
      if (!rt.npc) continue
      const obj = rt.obj
      const actors = rts.filter((r) => r !== rt && (r.entity.tags.includes('player') || r.entity.components.player)).map((r) => ({ id: r.entity.id, name: r.entity.name, position: r.obj.position, isPlayer: true }))
      const obstacles = rts.filter((r) => r !== rt && r.entity.components.collider).map((r) => ({ position: r.obj.position, radius: 1 }))
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion)
      const perception = perceive(obj.position, forward, rt.npc.brain, { actors, obstacles, home: obj.position.clone(), time })
      updateEmotion(rt.npc.state, rt.npc.brain, perception, time)
      if (perception.playerVisible) remember(rt.npc.state, { t: time, kind: 'saw_player' }, rt.npc.brain.memoryCapacity)
      const best = scoreActions(rt.npc.brain, rt.npc.state, perception, time)[0]
      if (best && (best.id === 'patrol' || best.id === 'chase') && best.score > 0.4) {
        const target = best.id === 'chase' && perception.lastSeenPlayerPos ? perception.lastSeenPlayerPos : new THREE.Vector3(obj.position.x + Math.cos(time * 0.3) * rt.npc.brain.patrolRadius, obj.position.y, obj.position.z + Math.sin(time * 0.25) * rt.npc.brain.patrolRadius)
        const step = steeringStep(obj.position, target, rt.npc.brain.moveSpeed, dt, obstacles)
        step.y = 0
        obj.position.add(step)
        const dir = target.clone().sub(obj.position)
        if (dir.lengthSq() > 0.001) obj.rotation.y = Math.atan2(dir.x, dir.z)
      }
    }

    // scripts
    for (const rt of rts) {
      if (rt.hooks?.onUpdate) {
        try {
          const ctx = buildCtx(rt)
          ;(ctx.world as { time: number }).time = time
          ;(ctx.world as { deltaTime: number }).deltaTime = dt
          ;(rt.hooks.onUpdate as (c: unknown, d: number) => void)(ctx, dt)
        } catch (e) {
          rt.errors++
          if (rt.errors > 10) rt.hooks = undefined
          console.error(`update error ${rt.entity.name}:`, e)
        }
      }
    }

    // follow camera
    if (playerRt) {
      const dist = 7
      const camPos = new THREE.Vector3(
        followTarget.position.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        followTarget.position.y + Math.sin(pitch) * dist + 2,
        followTarget.position.z + Math.cos(yaw) * Math.cos(pitch) * dist,
      )
      camera.position.lerp(camPos, 0.12)
      camera.lookAt(followTarget.position.x, followTarget.position.y + 1.2, followTarget.position.z)
    }

    renderer.render(scene, camera)
  }
  loop()
}

void boot()
