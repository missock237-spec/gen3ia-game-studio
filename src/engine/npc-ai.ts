// GEN3IA ENGINE — Hybrid NPC AI.
// Local execution (fast, per-frame): Perception → Memory → Goals →
// Utility scoring → Behavior Tree → Steering actions → World state.
// LLM (rare, server-side only): dialogue, quests, personality — via API
// with cache + cooldown (handled by the backend, never per-frame).

import * as THREE from 'three'
import type { NPCComponent } from './types'

export interface NPCPerception {
  nearestPlayerId: string | null
  nearestPlayerDistance: number
  playerVisible: boolean
  lastSeenPlayerPos: THREE.Vector3 | null
  threatLevel: number // 0..1
}

export interface NPCMemoryRecord {
  t: number
  kind: 'saw_player' | 'heard_sound' | 'took_damage' | 'met_player'
  detail?: string
  position?: THREE.Vector3
}

export interface NPCWorldView {
  /** all candidate targets: {id, position, isPlayer, name} */
  actors: Array<{ id: string; name: string; position: THREE.Vector3; isPlayer: boolean; faction?: string }>
  obstacles: Array<{ position: THREE.Vector3; radius: number }>
  home: THREE.Vector3
  time: number
}

export interface NPCState {
  memory: NPCMemoryRecord[]
  emotionalState: 'calm' | 'curious' | 'afraid' | 'angry' | 'hostile'
  currentAction: string
  currentTargetId: string | null
  patience: number
  relationship: Map<string, number> // -1..1 per actor
  lastLLMDialogueAt: number
}

export function createNPCState(): NPCState {
  return {
    memory: [],
    emotionalState: 'calm',
    currentAction: 'idle',
    currentTargetId: null,
    patience: 1,
    relationship: new Map(),
    lastLLMDialogueAt: 0,
  }
}

// ─────────────── Perception ───────────────

export function perceive(
  npcPos: THREE.Vector3,
  npcFacing: THREE.Vector3,
  brain: NPCComponent,
  world: NPCWorldView,
): NPCPerception {
  let nearest: { id: string; pos: THREE.Vector3; isPlayer: boolean } | null = null
  let nearestDist = Infinity
  const fovRad = (brain.fovDeg * Math.PI) / 180
  const forward = npcFacing.clone().normalize()

  for (const actor of world.actors) {
    const d = npcPos.distanceTo(actor.position)
    if (d < nearestDist && (actor.isPlayer || actor.faction !== brain.faction)) {
      nearest = { id: actor.id, pos: actor.position, isPlayer: actor.isPlayer }
      nearestDist = d
    }
  }

  let playerVisible = false
  if (nearest && nearestDist <= brain.sightRange) {
    const toTarget = nearest.pos.clone().sub(npcPos).normalize()
    const angle = forward.angleTo(toTarget)
    const inFov = angle <= fovRad / 2 || nearestDist < brain.hearingRange * 0.6
    const blocked = world.obstacles.some((o) => {
      const to = nearest!.pos.clone().sub(o.position)
      const along = to.dot(npcPos.clone().sub(o.position).normalize())
      return to.length() < o.radius && along > 0
    })
    playerVisible = inFov && !blocked
  }

  const threat = Math.max(
    brain.aggression * (playerVisible ? 1 : 0.4),
    playerVisible ? 0.2 : 0,
  ) * (nearestDist < brain.sightRange / 2 ? 1 : 0.5)

  return {
    nearestPlayerId: nearest?.id ?? null,
    nearestPlayerDistance: nearestDist,
    playerVisible,
    lastSeenPlayerPos: playerVisible && nearest ? nearest.pos.clone() : null,
    threatLevel: threat,
  }
}

// ─────────────── Memory ───────────────

export function remember(state: NPCState, rec: NPCMemoryRecord, capacity: number) {
  state.memory.push(rec)
  if (state.memory.length > capacity) state.memory.shift()
}

export function recallPlayerFrequency(state: NPCState, windowSec: number, now: number): number {
  const recent = state.memory.filter((m) => now - m.t < windowSec && m.kind.startsWith('saw'))
  return Math.min(1, recent.length / 10)
}

// ─────────────── Utility AI: score actions ───────────────

export type NPCActionId = 'idle' | 'patrol' | 'greet' | 'flee' | 'chase' | 'attack' | 'dialogue' | 'flee_home'

export function scoreActions(
  brain: NPCComponent,
  state: NPCState,
  perception: NPCPerception,
  now: number,
): Array<{ id: NPCActionId; score: number }> {
  const scores: Array<{ id: NPCActionId; score: number }> = []
  const playerSeenRecently = state.memory.some((m) => now - m.t < 8 && (m.kind === 'saw_player' || m.kind === 'met_player'))
  const familiarity = state.currentTargetId ? (state.relationship.get(state.currentTargetId) ?? 0) : 0

  scores.push({ id: 'idle', score: 0.15 + (1 - perception.threatLevel) * 0.2 })
  scores.push({ id: 'patrol', score: 0.35 + brain.curiosity * 0.3 - perception.threatLevel * 0.3 })

  if (perception.playerVisible) {
    const close = perception.nearestPlayerDistance < 4
    scores.push({ id: 'greet', score: brain.friendliness * (close ? 1 : 0.4) - brain.aggression * 0.5 })
    scores.push({ id: 'dialogue', score: brain.friendliness * 0.7 * (close ? 1 : 0.2) - brain.aggression })
    scores.push({ id: 'chase', score: brain.aggression * (perception.playerVisible ? 0.8 : 0.2) })
    scores.push({ id: 'attack', score: brain.aggression * (perception.nearestPlayerDistance < 3 ? 0.9 : 0.3) - brain.fear * 0.5 })
    scores.push({ id: 'flee', score: brain.fear * (close ? 1 : 0.4) - brain.aggression * 0.8 })
  } else if (playerSeenRecently) {
    scores.push({ id: 'flee', score: brain.fear * 0.5 - brain.aggression * 0.5 })
  }

  if (state.emotionalState === 'afraid' && state.memory.some((m) => m.kind === 'took_damage' && now - m.t < 12)) {
    scores.push({ id: 'flee_home', score: 1.2 })
  }
  if (familiarity < -0.5) scores.push({ id: 'flee', score: scores.find((s) => s.id === 'flee')!.score + 0.5 })

  return scores.sort((a, b) => b.score - a.score)
}

// ─────────────── Behavior Tree (compact but real) ───────────────

export interface BTContext {
  state: NPCState
  brain: NPCComponent
  perception: NPCPerception
  now: number
  dt: number
  /** actions implemented by the runtime adapter */
  moveTo(target: THREE.Vector3, speed: number): void
  stop(): void
  face(pos: THREE.Vector3): void
  say(text: string): void
  home: THREE.Vector3
  /** returns true when an LLM dialogue was actually requested (cooldown respected server-side) */
  requestDialogue(playerId: string): boolean
}

type BTNode = { tick(ctx: BTContext): 'success' | 'failure' | 'running' }

export function buildBehaviorTree(): BTNode {
  const seq = (...children: BTNode[]): BTNode => ({
    tick(ctx) {
      for (const c of children) {
        const r = c.tick(ctx)
        if (r !== 'success') return r
      }
      return 'success'
    },
  })
  const sel = (...children: BTNode[]): BTNode => ({
    tick(ctx) {
      for (const c of children) {
        const r = c.tick(ctx)
        if (r !== 'failure') return r
      }
      return 'failure'
    },
  })
  const cond = (fn: (c: BTContext) => boolean): BTNode => ({
    tick(ctx) { return fn(ctx) ? 'success' : 'failure' },
  })
  const act = (id: NPCActionId, fn: (c: BTContext) => 'success' | 'failure' | 'running'): BTNode => ({
    tick(ctx) {
      ctx.state.currentAction = id
      return fn(ctx)
    },
  })

  const fleeFrom = act('flee', (c) => {
    if (!c.perception.lastSeenPlayerPos) return 'failure'
    const away = c.home.clone().add(
      c.perception.lastSeenPlayerPos.clone().sub(c.home).negate().setLength(c.brain.patrolRadius * 1.5),
    )
    c.moveTo(away, c.brain.moveSpeed * 1.6)
    c.state.emotionalState = 'afraid'
    return 'running'
  })

  const patrol = act('patrol', (c) => {
    const t = c.now * 0.25
    const target = new THREE.Vector3(
      c.home.x + Math.cos(t) * c.brain.patrolRadius * 0.7,
      c.home.y,
      c.home.z + Math.sin(t * 0.8) * c.brain.patrolRadius * 0.7,
    )
    c.moveTo(target, c.brain.moveSpeed * 0.6)
    c.state.emotionalState = 'calm'
    return 'running'
  })

  const greetAndDialogue = sel(
    seq(
      cond((c) => c.perception.playerVisible && c.perception.nearestPlayerDistance < 4),
      act('greet', (c) => {
        c.state.emotionalState = 'curious'
        c.face(c.perception.lastSeenPlayerPos ?? c.home)
        c.stop()
        return 'success'
      }),
      cond((c) => c.now - c.state.lastLLMDialogueAt > 45),
      act('dialogue', (c) => {
        const ok = c.requestDialogue(c.perception.nearestPlayerId!)
        if (ok) c.state.lastLLMDialogueAt = c.now
        return ok ? 'success' : 'failure'
      }),
    ),
  )

  const combat = sel(
    seq(
      cond((c) => c.brain.aggression > 0.5 && c.perception.playerVisible && c.perception.nearestPlayerDistance < c.brain.sightRange),
      act('chase', (c) => {
        if (!c.perception.lastSeenPlayerPos) return 'failure'
        c.state.emotionalState = c.brain.aggression > 0.7 ? 'hostile' : 'angry'
        c.moveTo(c.perception.lastSeenPlayerPos, c.brain.moveSpeed * 1.3)
        return 'running'
      }),
    ),
    seq(
      cond((c) => c.state.emotionalState === 'hostile' && c.perception.nearestPlayerDistance < 2.2),
      act('attack', (c) => {
        c.face(c.perception.lastSeenPlayerPos ?? c.home)
        return 'success'
      }),
    ),
  )

  return sel(
    // 1) Survival first
    seq(cond((c) => c.state.emotionalState === 'afraid'), fleeFrom),
    // 2) Combat
    combat,
    // 3) Social
    greetAndDialogue,
    // 4) Fallback: patrol / idle
    patrol,
    act('idle', (c) => { c.stop(); return 'success' }),
  )
}

// ─────────────── Steering (movement integration, obstacle aware) ───────────────

export function steeringStep(
  pos: THREE.Vector3,
  target: THREE.Vector3,
  speed: number,
  dt: number,
  obstacles: Array<{ position: THREE.Vector3; radius: number }>,
): THREE.Vector3 {
  const desired = target.clone().sub(pos)
  desired.y = 0
  if (desired.lengthSq() < 0.0004) return new THREE.Vector3()
  desired.normalize().multiplyScalar(speed)

  // obstacle avoidance: push away from close obstacles
  for (const o of obstacles) {
    const away = pos.clone().sub(o.position)
    away.y = 0
    const d = away.length()
    if (d < o.radius + 0.8 && d > 0.0001) {
      away.normalize().multiplyScalar((o.radius + 0.8 - d) * 4)
      desired.add(away)
    }
  }
  const step = desired.multiplyScalar(dt)
  return step
}

/** Emotional state machine — updates from perception/memory */
export function updateEmotion(state: NPCState, brain: NPCComponent, perception: NPCPerception, now: number) {
  const recentDamage = state.memory.some((m) => m.kind === 'took_damage' && now - m.t < 10)
  if (recentDamage) state.emotionalState = brain.aggression > 0.5 ? 'angry' : 'afraid'
  else if (perception.playerVisible && brain.friendliness > 0.5) state.emotionalState = 'curious'
  else if (perception.threatLevel > 0.6 && brain.aggression > 0.6) state.emotionalState = 'hostile'
  else if (perception.threatLevel < 0.2) state.emotionalState = 'calm'
}
