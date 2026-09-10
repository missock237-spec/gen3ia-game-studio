// GEN3IA ENGINE — Real rigid-body physics via cannon-es.
import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import type { SceneDoc } from './scene'
import type { EntityData } from './types'

export interface PhysicsEvent {
  entityId: string
  otherId: string
}

interface BodyRecord {
  body: CANNON.Body
  entityId: string
  shape: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'mesh'
}

export class PhysicsWorld {
  world: CANNON.World
  private records: BodyRecord[] = []
  private entityIdToBody = new Map<string, CANNON.Body>()
  private bodyIdToEntity = new Map<number, string>()
  private collisionListeners = new Set<(e: PhysicsEvent) => void>()
  private materials = new Map<string, CANNON.Material>()

  constructor(gravity = -9.82) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) })
    this.world.broadphase = new CANNON.SAPBroadphase(this.world)
    this.world.allowSleep = true
    ;(this.world.solver as CANNON.GSSolver).iterations = 10
    this.world.addEventListener('beginContact', this.onBeginContact)
  }

  private onBeginContact = (ev: { bodyA: CANNON.Body; bodyB: CANNON.Body }) => {
    const a = this.bodyIdToEntity.get(ev.bodyA.id)
    const b = this.bodyIdToEntity.get(ev.bodyB.id)
    if (!a || !b) return
    this.collisionListeners.forEach((l) => {
      l({ entityId: a, otherId: b })
      l({ entityId: b, otherId: a })
    })
  }

  onCollision(fn: (e: PhysicsEvent) => void): () => void {
    this.collisionListeners.add(fn)
    return () => this.collisionListeners.delete(fn)
  }

  getMaterial(name: string): CANNON.Material {
    let m = this.materials.get(name)
    if (!m) { m = new CANNON.Material(name); this.materials.set(name, m) }
    return m
  }

  private colliderShape(entity: EntityData): BodyRecord['shape'] {
    return (entity.components.collider?.shape ?? 'box') as BodyRecord['shape']
  }

  /** Add body for an entity (world transform from three object). */
  addBody(entity: EntityData, object: THREE.Object3D): CANNON.Body | null {
    if (!entity.components.rigidBody) return null
    const rb = entity.components.rigidBody
    const shapeKind = this.colliderShape(entity)
    let shape: CANNON.Shape | null = null

    object.updateWorldMatrix(true, false)
    const scale = new THREE.Vector3()
    object.getWorldScale(scale)

    switch (shapeKind) {
      case 'sphere': {
        const r = entity.components.collider?.radius ?? 0.5
        shape = new CANNON.Sphere(Math.max(0.01, r * Math.max(scale.x, scale.y, scale.z)))
        break
      }
      case 'cylinder':
        shape = new CANNON.Cylinder(
          (entity.components.collider?.radius ?? 0.5) * scale.x,
          (entity.components.collider?.radius ?? 0.5) * scale.x,
          (entity.components.collider?.height ?? 1) * scale.y, 12)
        break
      case 'capsule': {
        // approximate with cylinder + spheres? cannon-es has no capsule; use cylinder
        const r = entity.components.collider?.radius ?? 0.4
        const h = entity.components.collider?.height ?? 1.2
        shape = new CANNON.Cylinder(r * scale.x, r * scale.x, (h + 2 * r) * scale.y, 12)
        break
      }
      case 'mesh': {
        // approximate mesh collider with oriented bounding box of the first mesh (robust)
        const mesh = object.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined
        if (mesh && mesh.geometry) {
          mesh.geometry.computeBoundingBox()
          const bb = mesh.geometry.boundingBox!
          const size = new THREE.Vector3(); bb.getSize(size)
          shape = new CANNON.Box(new CANNON.Vec3(
            Math.max(0.01, size.x / 2 * scale.x),
            Math.max(0.01, size.y / 2 * scale.y),
            Math.max(0.01, size.z / 2 * scale.z),
          ))
        } else {
          shape = new CANNON.Box(new CANNON.Vec3(0.5 * scale.x, 0.5 * scale.y, 0.5 * scale.z))
        }
        break
      }
      default: {
        // derive box half extents from mesh params*scale or collider override
        const size = entity.components.collider?.size
        let hx = 0.5, hy = 0.5, hz = 0.5
        const meshComp = entity.components.mesh
        if (meshComp?.params) {
          hx = (meshComp.params.width ?? 1) / 2
          hy = (meshComp.params.height ?? 1) / 2
          hz = (meshComp.params.depth ?? 1) / 2
        }
        shape = new CANNON.Box(new CANNON.Vec3(
          Math.max(0.01, (size?.x ?? hx * 2) / 2 * scale.x),
          Math.max(0.01, (size?.y ?? hy * 2) / 2 * scale.y),
          Math.max(0.01, (size?.z ?? hz * 2) / 2 * scale.z),
        ))
      }
    }
    if (!shape) return null

    const body = new CANNON.Body({
      mass: rb.type === 'dynamic' ? Math.max(0.001, rb.mass) : 0,
      type: rb.type === 'dynamic' ? CANNON.Body.DYNAMIC : rb.type === 'kinematic' ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC,
      shape,
      position: new CANNON.Vec3(object.position.x, object.position.y, object.position.z),
      linearDamping: rb.linearDamping,
      angularDamping: rb.angularDamping,
      material: this.getMaterial('default'),
    })
    body.quaternion.setFromEuler(object.rotation.x, object.rotation.y, object.rotation.z)
    if (rb.freezeRotation) body.angularFactor.set(0, 0, 0)

    // Contact material defaults from restitution/friction

    this.world.addBody(body)
    const rec: BodyRecord = { body, entityId: entity.id, shape: shapeKind }
    this.records.push(rec)
    this.entityIdToBody.set(entity.id, body)
    this.bodyIdToEntity.set(body.id, entity.id)
    return body
  }

  removeBody(entityId: string) {
    const body = this.entityIdToBody.get(entityId)
    if (!body) return
    this.world.removeBody(body)
    this.entityIdToBody.delete(entityId)
    this.bodyIdToEntity.delete(body.id)
    this.records = this.records.filter((r) => r.body !== body)
  }

  /** Step world and write transforms back into three objects. */
  step(dt: number, objects: Map<string, THREE.Object3D>) {
    this.world.step(1 / 60, dt, 3)
    for (const rec of this.records) {
      const obj = objects.get(rec.entityId)
      if (!obj) continue
      obj.position.set(rec.body.position.x, rec.body.position.y, rec.body.position.z)
      if (rec.body.angularFactor.x !== 0 || rec.body.angularFactor.y !== 0 || rec.body.angularFactor.z !== 0) {
        obj.quaternion.set(rec.body.quaternion.x, rec.body.quaternion.y, rec.body.quaternion.z, rec.body.quaternion.w)
      }
    }
  }

  bodyOf(entityId: string): CANNON.Body | undefined { return this.entityIdToBody.get(entityId) }
  isGrounded(entityId: string): boolean {
    const body = this.entityIdToBody.get(entityId)
    if (!body) return false
    // simple ground check: contact with any body whose normal.y > 0.5
    for (const c of this.world.contacts) {
      if (c.bi === body || c.bj === body) {
        const n = c.ni.clone()
        if (c.bi === body) n.negate(n)
        if (n.y > 0.5) return true
      }
    }
    return false
  }

  raycast(from: THREE.Vector3, to: THREE.Vector3): { entityId: string; point: THREE.Vector3; distance: number } | null {
    const result = new CANNON.RaycastResult()
    this.world.raycastClosest(
      new CANNON.Vec3(from.x, from.y, from.z),
      new CANNON.Vec3(to.x, to.y, to.z),
      { skipBackfaces: true },
      result,
    )
    if (!result.hasHit || !result.body) return null
    const entityId = this.bodyIdToEntity.get(result.body.id)
    return {
      entityId: entityId ?? '',
      point: new THREE.Vector3(result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z),
      distance: result.distance,
    }
  }

  dispose() {
    this.world.removeEventListener('beginContact', this.onBeginContact)
    this.records = []
    this.entityIdToBody.clear()
    this.bodyIdToEntity.clear()
    this.collisionListeners.clear()
  }
}
