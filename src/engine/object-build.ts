// GEN3IA ENGINE — Builds real THREE objects from entity data.
// Shared by the editor renderer, the play runtime and exported games.
import * as THREE from 'three'
import type { EntityData, MaterialComponent, MeshComponent, ParticleEmitterComponent } from './types'

export type AssetResolver = (assetId: string) => { url: string; mimeType: string; name: string } | undefined

const texCache = new Map<string, THREE.Texture>()
const modelCache = new Map<string, THREE.Group>()

export function clearObjectCaches() {
  texCache.clear()
  modelCache.clear()
}

function loadTexture(url: string): THREE.Texture {
  const cached = texCache.get(url)
  if (cached) return cached
  const tex = new THREE.TextureLoader().load(url)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  texCache.set(url, tex)
  return tex
}

function noise2D(x: number, y: number, seed: number): number {
  // deterministic value noise (hash-based)
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407
  h = (h ^ (h >> 13)) * 1274126177
  h = h ^ (h >> 16)
  return ((h % 100000) / 100000)
}

function smoothNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = noise2D(xi, yi, seed), b = noise2D(xi + 1, yi, seed)
  const c = noise2D(xi, yi + 1, seed), d = noise2D(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export function terrainHeight(x: number, z: number, seed: number, heightScale: number, shape: string): number {
  const s = shape === 'plains' ? 0.8 : shape === 'mountains' ? 4.2 : shape === 'islands' ? 3 : 1.6
  let h = 0
  h += smoothNoise(x * 0.02, z * 0.02, seed) * 0.6
  h += smoothNoise(x * 0.06, z * 0.06, seed + 7) * 0.25
  h += smoothNoise(x * 0.15, z * 0.15, seed + 13) * 0.1
  h = (h - 0.47) * s * heightScale
  if (shape === 'islands') h -= smoothNoise(x * 0.01, z * 0.01, seed + 31) * 4
  return h
}

export function buildTerrainGeometry(
  sizeX: number, sizeZ: number, segments: number, seed: number,
  heightScale: number, shape: string,
  colorLow: string, colorHigh: string,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segments, segments)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const cLow = new THREE.Color(colorLow)
  const cHigh = new THREE.Color(colorHigh)
  const tmp = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const h = terrainHeight(x, z, seed, heightScale, shape)
    pos.setY(i, h)
    const t = THREE.MathUtils.clamp((h / (heightScale * 2 + 0.001)) + 0.5, 0, 1)
    tmp.copy(cLow).lerp(cHigh, t)
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

function geometryFromMesh(mesh: MeshComponent): THREE.BufferGeometry | null {
  const p = mesh.params ?? {}
  switch (mesh.kind) {
    case 'box': {
      const { width = 1, height = 1, depth = 1 } = p
      return new THREE.BoxGeometry(width, height, depth)
    }
    case 'sphere': return new THREE.SphereGeometry(p.radius ?? 0.5, 32, 20)
    case 'cylinder': return new THREE.CylinderGeometry(p.radiusTop ?? 0.5, p.radiusBottom ?? 0.5, p.height ?? 1, 28)
    case 'cone': return new THREE.ConeGeometry(p.radius ?? 0.5, p.height ?? 1, 28)
    case 'plane': return new THREE.PlaneGeometry(p.width ?? 4, p.height ?? 4).rotateX(-Math.PI / 2)
    case 'capsule': return new THREE.CapsuleGeometry(p.radius ?? 0.4, p.length ?? 0.8, 8, 20)
    case 'torus': return new THREE.TorusGeometry(p.radius ?? 0.5, p.tube ?? 0.2, 16, 40)
    case 'model': return null // handled via GLTF
    default: return new THREE.BoxGeometry(1, 1, 1)
  }
}

function materialFrom(mat: MaterialComponent, resolve: AssetResolver): THREE.Material {
  const params: THREE.MeshStandardMaterialParameters = {
    color: new THREE.Color(mat.color),
    metalness: THREE.MathUtils.clamp(mat.metalness, 0, 1),
    roughness: THREE.MathUtils.clamp(mat.roughness, 0, 1),
    emissive: new THREE.Color(mat.emissive),
    emissiveIntensity: mat.emissiveIntensity,
    transparent: mat.opacity < 1,
    opacity: THREE.MathUtils.clamp(mat.opacity, 0, 1),
    wireframe: mat.wireframe,
    side: mat.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  }
  const m = new THREE.MeshStandardMaterial(params)
  if (mat.textureAssetId) {
    const a = resolve(mat.textureAssetId)
    if (a && a.mimeType.startsWith('image/')) m.map = loadTexture(a.url)
  }
  if (mat.normalMapAssetId) {
    const a = resolve(mat.normalMapAssetId)
    if (a && a.mimeType.startsWith('image/')) {
      m.normalMap = loadTexture(a.url)
      m.normalScale = new THREE.Vector2(mat.normalScale ?? 1, mat.normalScale ?? 1)
    }
  }
  return m
}

export function buildParticles(comp: ParticleEmitterComponent): { points: THREE.Points; update: (dt: number) => void } {
  const n = Math.max(1, Math.min(5000, comp.count))
  const positions = new Float32Array(n * 3)
  const velocities = new Float32Array(n * 3)
  const life = new Float32Array(n)
  const maxLife = Math.max(0.1, comp.lifetime)
  const cStart = new THREE.Color(comp.color)
  const cEnd = new THREE.Color(comp.colorEnd)
  const colors = new Float32Array(n * 3)
  const sizes: number[] = new Array(n).fill(comp.size)

  for (let i = 0; i < n; i++) {
    life[i] = Math.random() * maxLife
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * comp.spread
    positions[i * 3] = Math.cos(a) * r
    positions[i * 3 + 1] = Math.random() * 0.2
    positions[i * 3 + 2] = Math.sin(a) * r
    velocities[i * 3] = (Math.random() - 0.5) * comp.speed * 0.4
    velocities[i * 3 + 1] = comp.speed * (0.6 + Math.random() * 0.6)
    velocities[i * 3 + 2] = (Math.random() - 0.5) * comp.speed * 0.4
    colors[i * 3] = cStart.r; colors[i * 3 + 1] = cStart.g; colors[i * 3 + 2] = cStart.b
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.PointsMaterial({
    size: comp.size, vertexColors: true, transparent: true, opacity: 0.9,
    sizeAttenuation: true, depthWrite: false,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false

  const update = (dt: number) => {
    const pos = geo.attributes.position as THREE.BufferAttribute
    const col = geo.attributes.color as THREE.BufferAttribute
    for (let i = 0; i < n; i++) {
      life[i] -= dt
      if (life[i] <= 0) {
        if (!comp.looping) { pos.setY(i, -1000); continue }
        life[i] = maxLife
        pos.setX(i, 0); pos.setY(i, 0); pos.setZ(i, 0)
        velocities[i * 3] = (Math.random() - 0.5) * comp.speed * 0.4
        velocities[i * 3 + 1] = comp.speed * (0.6 + Math.random() * 0.6)
        velocities[i * 3 + 2] = (Math.random() - 0.5) * comp.speed * 0.4
      }
      const nx = pos.getX(i) + velocities[i * 3] * dt
      const ny = pos.getY(i) + velocities[i * 3 + 1] * dt
      const nz = pos.getZ(i) + velocities[i * 3 + 2] * dt
      velocities[i * 3 + 1] += comp.gravity * dt
      pos.setXYZ(i, nx, ny, nz)
      const t = THREE.MathUtils.clamp(life[i] / maxLife, 0, 1)
      const r = cEnd.r + (cStart.r - cEnd.r) * t
      const g = cEnd.g + (cStart.g - cEnd.g) * t
      const b = cEnd.b + (cStart.b - cEnd.b) * t
      col.setXYZ(i, r, g, b)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    ;(mat as THREE.PointsMaterial).size = sizes[0]
  }
  return { points, update }
}

/** Water plane with animated waves (real vertex animation) */
export function buildWater(size: number, level: number, color: string, waveHeight: number): { mesh: THREE.Mesh; update: (t: number) => void } {
  const geo = new THREE.PlaneGeometry(size, size, 48, 48)
  geo.rotateX(-Math.PI / 2)
  const base = Float32Array.from((geo.attributes.position as THREE.BufferAttribute).array)
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), transparent: true, opacity: 0.72,
    roughness: 0.08, metalness: 0.4,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = level
  mesh.receiveShadow = true
  const update = (t: number) => {
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2]
      pos.setY(i, Math.sin(x * 0.35 + t * 1.4) * waveHeight + Math.cos(z * 0.28 + t * 1.1) * waveHeight * 0.7)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  }
  return { mesh, update }
}

/** Result wrapper: three object + optional per-frame updaters */
export interface BuiltObject {
  root: THREE.Object3D
  update?: (dt: number, t: number) => void
  isGizmolessModel?: boolean
}

/**
 * Build the three.js object tree for an entity (children built by caller).
 */
export async function buildEntityObject(
  entity: EntityData,
  resolve: AssetResolver,
): Promise<BuiltObject> {
  const root = new THREE.Group()
  root.name = entity.name
  root.userData.entityId = entity.id
  const c = entity.components

  let update: ((dt: number, t: number) => void) | undefined

  // Sky (attached to env entity) — real atmospheric scattering (three.js Sky)
  if (c.sky) {
    try {
      const { Sky } = await import('three/examples/jsm/objects/Sky.js')
      const sky = new Sky()
      sky.scale.setScalar(1000)
      const u = sky.material.uniforms
      u.turbidity.value = c.sky.turbidity
      u.rayleigh.value = c.sky.rayleigh
      u.mieCoefficient.value = c.sky.mieCoefficient
      u.mieDirectionalG.value = c.sky.mieDirectionalG
      const sun = new THREE.Vector3().setFromSphericalCoords(
        1,
        Math.max(0.01, Math.PI / 2 - c.sky.sunElevation),
        c.sky.sunAzimuth,
      )
      u.sunPosition.value.copy(sun)
      sky.name = '__sky'
      root.add(sky)
    } catch {
      const skyMesh = new THREE.Mesh(
        new THREE.SphereGeometry(500, 16, 12),
        new THREE.MeshBasicMaterial({ color: '#7fb2e5', side: THREE.BackSide, depthWrite: false }),
      )
      skyMesh.name = '__sky'
      root.add(skyMesh)
    }
  }

  // Light
  if (c.light) {
    const l = c.light
    let light: THREE.Light
    switch (l.kind) {
      case 'directional': {
        const dl = new THREE.DirectionalLight(new THREE.Color(l.color), l.intensity)
        dl.target.position.set(0, 0, 0)
        light = dl
        break
      }
      case 'point': light = new THREE.PointLight(new THREE.Color(l.color), l.intensity, l.distance || 0, 2); break
      case 'spot': {
        const sl = new THREE.SpotLight(new THREE.Color(l.color), l.intensity, l.distance || 0, l.angle || Math.PI / 6, l.penumbra || 0, 2)
        sl.target.position.set(0, -1, 0)
        light = sl
        break
      }
      case 'hemisphere': light = new THREE.HemisphereLight(new THREE.Color(l.color), '#3a3a2f', l.intensity); break
      default: light = new THREE.AmbientLight(new THREE.Color(l.color), l.intensity)
    }
    if ('castShadow' in light && l.castShadow) {
      light.castShadow = true
      const withShadow = light as THREE.Light & { shadow?: THREE.LightShadow }
      if (withShadow.shadow) {
        withShadow.shadow.mapSize.set(1024, 1024)
        withShadow.shadow.bias = -0.0004
      }
    }
    root.add(light)
  }

  // Camera
  if (c.camera) {
    const cam = new THREE.PerspectiveCamera(c.camera.fov, 16 / 9, c.camera.near, c.camera.far)
    cam.name = '__camera'
    root.add(cam)
  }

  // Mesh
  if (c.mesh) {
    const m = c.mesh
    if (m.kind === 'model' && m.assetId) {
      const asset = resolve(m.assetId)
      if (asset) {
        try {
          let model = modelCache.get(asset.url)
          if (!model) {
            const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
            const loader = new GLTFLoader()
            const buf = await fetch(asset.url).then((r) => r.arrayBuffer())
            const gltf = await loader.parseAsync(buf, '')
            model = gltf.scene
            modelCache.set(asset.url, model)
          }
          const inst = model.clone(true)
          inst.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = m.castShadow
              o.receiveShadow = m.receiveShadow
            }
          })
          root.add(inst)
        } catch {
          // fallback wire box so the entity is visible/selectable
          const helper = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ color: '#ff5555', wireframe: true }),
          )
          root.add(helper)
        }
      }
    } else {
      const geo = geometryFromMesh(m)
      if (geo) {
        const mat = c.material ? materialFrom(c.material, resolve) : new THREE.MeshStandardMaterial({ color: '#9aa5b1' })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.castShadow = m.castShadow
        mesh.receiveShadow = m.receiveShadow
        root.add(mesh)
      }
    }
  }

  // Terrain
  if (c.terrain) {
    const t = c.terrain
    const geo = buildTerrainGeometry(t.sizeX, t.sizeZ, Math.min(160, Math.max(16, t.segments)), t.seed, t.heightScale, t.shape, t.colorLow, t.colorHigh)
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }))
    mesh.receiveShadow = true
    mesh.castShadow = true
    root.add(mesh)
  }

  // Water
  if (c.water) {
    const w = buildWater(c.water.size, c.water.level, c.water.color, c.water.waveHeight)
    root.add(w.mesh)
    const prev = update
    update = (dt, t) => { w.update(t); prev?.(dt, t) }
  }

  // Particles
  if (c.particleEmitter) {
    const p = buildParticles(c.particleEmitter)
    root.add(p.points)
    const prev = update
    update = (dt, t) => { p.update(dt); prev?.(dt, t) }
  }

  // Visibility
  root.visible = entity.visible

  return { root, update }
}
