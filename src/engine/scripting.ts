// GEN3IA ENGINE — User script sandbox (browser runtime).
// User scripts NEVER run on the server. They compile into an isolated scope
// exposing a controlled API surface (ctx). Errors are caught per-frame and
// scripts auto-disable after repeated failures to protect the game loop.

export interface ScriptLogFn { (level: 'info' | 'warn' | 'error', msg: string): void }

export interface ScriptEntityAPI {
  id: string
  name: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  setPosition(x: number, y: number, z: number): void
  rotate(x: number, y: number, z: number): void
  lookAt(x: number, y: number, z: number): void
  body: {
    velocity: { x: number; y: number; z: number }
    quaternion: {
      x: number; y: number; z: number; w: number
      set(x: number, y: number, z: number, w: number): void
      normalize(): void
    }
    applyImpulse(x: number, y: number, z: number): void
    setVelocity(x: number, y: number, z: number): void
  } | null
  grounded: boolean
  health: { max: number; current: number } | null
  distanceTo(entityId: string): number
  find(nameOrTag: string): string | null
}

export interface ScriptWorldAPI {
  time: number
  deltaTime: number
  find(nameOrTag: string): string | null
  log: ScriptLogFn
  on(event: 'collision', cb: (otherId: string) => void): void
  spawn(entityId: string): void
  destroy(entityId: string): void
}

export interface ScriptInputAPI {
  key(code: string): boolean
  axis(): { x: number; z: number }
  pointer(): { x: number; y: number; down: boolean }
}

export interface ScriptCtx {
  entity: ScriptEntityAPI
  world: ScriptWorldAPI
  input: ScriptInputAPI
  /** Alias de ctx.world.log — accepte (msg) ou (level, msg). */
  log(levelOrMsg: 'info' | 'warn' | 'error' | string, msg?: string): void
  math: {
    clamp(v: number, min: number, max: number): number
    lerp(a: number, b: number, t: number): number
    rand(min: number, max: number): number
    randomInt(min: number, max: number): number
    dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number
    sin(v: number): number
    cos(v: number): number
    atan2(y: number, x: number): number
    PI: number
    Vec3: { new (x: number, y: number, z: number): { x: number; y: number; z: number } }
  }
}

export interface CompiledScript {
  onStart?: (ctx: ScriptCtx) => void
  onUpdate?: (ctx: ScriptCtx, dt: number) => void
  onCollision?: (ctx: ScriptCtx, other: { entityId: string; name: string }) => void
  onKey?: (ctx: ScriptCtx, code: string, down: boolean) => void
}

const FORBIDDEN = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\blocalStorage\b/,
  /\bindexedDB\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bWebSocket\b/,
]

export interface ScriptCompileResult {
  ok: boolean
  script?: CompiledScript
  error?: string
}

/** Static syntax check (also usable server-side for build validation). */
export function validateScriptSyntax(source: string): { ok: boolean; error?: string } {
  if (typeof source !== 'string' || source.length > 100_000) return { ok: false, error: 'Script too large or invalid' }
  for (const rx of FORBIDDEN) {
    if (rx.test(source)) return { ok: false, error: `Forbidden API in sandboxed script: ${rx.source}` }
  }
  try {
     
    new Function(source)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Syntax error' }
  }
}

/** Compile a user script into lifecycle hooks running in a strict, API-limited scope. */
export function compileScript(source: string): ScriptCompileResult {
  const check = validateScriptSyntax(source)
  if (!check.ok) return { ok: false, error: check.error }
  try {
     
    const factory = new Function(
      '"use strict";\n' +
      'const window = undefined, document = undefined, self = undefined, top = undefined, parent = undefined;\n' +
      source +
      '\n;return {' +
      'onStart: typeof onStart === "function" ? onStart : null,' +
      'onUpdate: typeof onUpdate === "function" ? onUpdate : null,' +
      'onCollision: typeof onCollision === "function" ? onCollision : null,' +
      'onKey: typeof onKey === "function" ? onKey : null' +
      '};',
    )
    const hooks = factory()
    return { ok: true, script: hooks as CompiledScript }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Compilation failed' }
  }
}

export class ScriptHost {
  private instances = new Map<string, { compiled: CompiledScript; errors: number; started: boolean }>()
  constructor(private log: ScriptLogFn, private maxErrors = 5) {}

  attach(entityId: string, source: string): ScriptCompileResult {
    const res = compileScript(source)
    if (!res.ok) {
      this.log('error', `Script compile error [${entityId}]: ${res.error}`)
      return res
    }
    this.instances.set(entityId, { compiled: res.script!, errors: 0, started: false })
    return res
  }

  detach(entityId: string) { this.instances.delete(entityId) }
  clear() { this.instances.clear() }

  start(entityId: string, ctx: ScriptCtx) {
    const inst = this.instances.get(entityId)
    if (!inst || inst.started || !inst.compiled.onStart) return
    inst.started = true
    this.safeRun(entityId, () => inst.compiled!.onStart!(ctx))
  }

  update(entityId: string, ctx: ScriptCtx, dt: number) {
    const inst = this.instances.get(entityId)
    if (!inst || !inst.compiled.onUpdate) return
    this.safeRun(entityId, () => inst.compiled!.onUpdate!(ctx, dt))
  }

  collision(entityId: string, ctx: ScriptCtx, other: { entityId: string; name: string }) {
    const inst = this.instances.get(entityId)
    if (!inst || !inst.compiled.onCollision) return
    this.safeRun(entityId, () => inst.compiled!.onCollision!(ctx, other))
  }

  key(entityId: string, ctx: ScriptCtx, code: string, down: boolean) {
    const inst = this.instances.get(entityId)
    if (!inst || !inst.compiled.onKey) return
    this.safeRun(entityId, () => inst.compiled!.onKey!(ctx, code, down))
  }

  private safeRun(entityId: string, fn: () => void) {
    const inst = this.instances.get(entityId)
    try {
      fn()
    } catch (e) {
      if (!inst) return
      inst.errors += 1
      this.log('error', `Script runtime error [${entityId}]: ${e instanceof Error ? e.message : String(e)}`)
      if (inst.errors >= this.maxErrors) {
        this.instances.delete(entityId)
        this.log('warn', `Script disabled for ${entityId} after ${this.maxErrors} errors`)
      }
    }
  }
}
