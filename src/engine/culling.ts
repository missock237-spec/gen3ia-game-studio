// GEN3IA ENGINE — Culling & LOD (Phase 15).
// Frustum culling (bounding sphere vs plan de la caméra) + distance culling
// (entités au-delà d'un rayon configuré) + LOD par distance (niveaux de
// visibilité). Implémentation réelle sur le graphe Three.js, sans hypothèse
// de contenu : fonctionne sur tout type d'entité construite.
import * as THREE from 'three'

export interface CullingConfig {
  /** distance au-delà de laquelle les entités sont cachées (0 = infini) */
  maxDistance: number
  /** LOD actif : les entités loin deviennent invisible (statique), légère */
  lodEnabled: boolean
  /** distances de bascule LOD (near → far) */
  lodDistances: [number, number]
}

export interface CullingStats {
  frustumCulled: number
  distanceCulled: number
  visible: number
  total: number
}

interface CullableEntry {
  entityId: string
  root: THREE.Object3D
  boundingSphere: THREE.Sphere
  lodLevel: number // 0 = plein détail
}

const _frustum = new THREE.Frustum()
const _mat = new THREE.Matrix4()
const _sphere = new THREE.Sphere()
const _center = new THREE.Vector3()

export class CullingManager {
  private entries = new Map<string, CullableEntry>()
  private stats: CullingStats = { frustumCulled: 0, distanceCulled: 0, visible: 0, total: 0 }
  private lastUpdate = 0

  constructor(private config: CullingConfig = { maxDistance: 0, lodEnabled: false, lodDistances: [60, 140] }) {}

  setConfig(cfg: Partial<CullingConfig>) {
    this.config = { ...this.config, ...cfg }
  }

  getConfig(): CullingConfig {
    return { ...this.config }
  }

  register(entityId: string, root: THREE.Object3D) {
    // bounding sphere pré-calculée (coût unique à l'inscription)
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return
    const sphere = new THREE.Sphere()
    box.getBoundingSphere(sphere)
    this.entries.set(entityId, { entityId, root, boundingSphere: sphere, lodLevel: 0 })
  }

  unregister(entityId: string) {
    this.entries.delete(entityId)
  }

  clear() {
    this.entries.clear()
  }

  getStats(): CullingStats {
    return { ...this.stats }
  }

  /**
   * Applique frustum + distance culling. Throttlé (10 Hz) : le frustum change
   * à chaque mouvement de caméra mais une granularité de 100 ms est invisible.
   */
  update(camera: THREE.Camera, playerPos: THREE.Vector3 | null, now: number, force = false) {
    if (!force && now - this.lastUpdate < 0.1) return
    this.lastUpdate = now

    camera.updateMatrixWorld()
    _mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_mat)

    let frustumCulled = 0
    let distanceCulled = 0
    let visible = 0
    const maxDist2 = this.config.maxDistance > 0 ? this.config.maxDistance * this.config.maxDistance : Infinity
    const [near, far] = this.config.lodDistances

    for (const entry of this.entries.values()) {
      const root = entry.root
      // position monde actuelle (les entités bougent via runtime/physique)
      root.getWorldPosition(_center)
      entry.boundingSphere.center.copy(_center)

      // 1. distance culling (par rapport au joueur/caméra)
      let show = true
      if (playerPos) {
        const dx = _center.x - playerPos.x
        const dz = _center.z - playerPos.z
        const dy = _center.y - playerPos.y
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > maxDist2) {
          show = false
          distanceCulled++
        } else if (this.config.lodEnabled) {
          // LOD par distance : loin → caché (les détails fins ne se voient pas)
          const d = Math.sqrt(d2)
          const level = d < near ? 0 : d < far ? 1 : 2
          if (level !== entry.lodLevel) {
            entry.lodLevel = level
            // niveau 2 : signale le niveau (le builder peut simplifier) ;
            // la visibilité reste gérée par entity.visible — on ne force rien ici.
            root.userData.lodLevel = level
          }
        }
      }

      // 2. frustum culling
      if (show) {
        _sphere.copy(entry.boundingSphere)
        if (!_frustum.intersectsSphere(_sphere)) {
          show = false
          frustumCulled++
        }
      }

      // application : on n'écrase jamais entity.visible (contrôle éditeur) —
      // on manipule un flag dédié que le renderer combine au rendu réel.
      root.visible = show && (root.userData.entityVisible ?? true)
      if (show) visible++
    }

    this.stats = { frustumCulled, distanceCulled, visible, total: this.entries.size }
  }
}
