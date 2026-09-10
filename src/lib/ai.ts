// AI Provider Manager — real providers with routing, timeout, retry, circuit breaker,
// usage tracking. Providers: z-ai (active in this environment) and Hugging Face
// Inference Providers (active when HF_TOKEN is configured).
import { createHash } from 'crypto'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

export type AITask = 'chat' | 'scene_command' | 'dialogue' | 'quest' | 'code' | 'classification'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AICompletionOptions {
  task: AITask
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  json?: boolean
  userId?: string
  projectId?: string
}

export interface AICompletionResult {
  text: string
  provider: string
  model: string
  latencyMs: number
  tokensIn: number
  tokensOut: number
  cached?: boolean
  estimatedCostUsd?: number
}

// ───────────────── Cache réponse (tâches déterministes) ─────────────────
const responseCache = new Map<string, { result: AICompletionResult; expiresAt: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 200

function cacheKey(opts: AICompletionOptions): string {
  const h = createHash('sha256')
  h.update(JSON.stringify({ t: opts.task, m: opts.messages, tmp: opts.temperature ?? 0.7 }))
  return h.digest('hex').slice(0, 32)
}

function cacheGet(key: string): AICompletionResult | null {
  const hit = responseCache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) { responseCache.delete(key); return null }
  return { ...hit.result, cached: true }
}

function cachePut(key: string, result: AICompletionResult) {
  if (responseCache.size >= CACHE_MAX) {
    const oldest = responseCache.keys().next().value
    if (oldest) responseCache.delete(oldest)
  }
  responseCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** Coût estimé (USD) — bornes HF Llama-70B : 0,75$/M in, 1$/M out. */
function estimateCost(tokensIn: number, tokensOut: number): number {
  return Math.round(((tokensIn * 0.75 + tokensOut * 1) / 1_000_000) * 10000) / 10000
}

// ─────────────────────── Circuit breaker ───────────────────────

interface BreakerState {
  failures: number
  openedAt: number | null
}

const breakers = new Map<string, BreakerState>()
const BREAKER_THRESHOLD = 4
const BREAKER_COOLDOWN_MS = 30_000

function breakerOpen(key: string): boolean {
  const b = breakers.get(key)
  if (!b || b.openedAt === null) return false
  if (Date.now() - b.openedAt > BREAKER_COOLDOWN_MS) {
    breakers.set(key, { failures: 0, openedAt: null })
    return false
  }
  return true
}

function breakerFailure(key: string) {
  const b = breakers.get(key) ?? { failures: 0, openedAt: null }
  b.failures += 1
  if (b.failures >= BREAKER_THRESHOLD) b.openedAt = Date.now()
  breakers.set(key, b)
}

function breakerSuccess(key: string) {
  breakers.set(key, { failures: 0, openedAt: null })
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ])
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ─────────────────────── Providers ───────────────────────

interface AIProvider {
  name: string
  available(): boolean
  complete(opts: AICompletionOptions): Promise<AICompletionResult>
}

/** z-ai provider — works in this environment, no token needed. */
class ZaiProvider implements AIProvider {
  name = 'zai'
  available() { return true }
  async complete(opts: AICompletionOptions): Promise<AICompletionResult> {
    const zai = await ZAI.create()
    const model = 'glm-4.5-air'
    const t0 = Date.now()
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: opts.messages as never[],
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
      }),
      90_000,
      'zai chat',
    )
    const choice = completion.choices[0]
    const text = choice?.message?.content ?? ''
    if (!text) throw new Error('Empty AI response')
    const latencyMs = Date.now() - t0
    const usage = (completion as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
    return {
      text, provider: this.name, model, latencyMs,
      tokensIn: usage?.prompt_tokens ?? 0,
      tokensOut: usage?.completion_tokens ?? 0,
    }
  }
}

/** Hugging Face Inference Providers — active when HF_TOKEN is set. */
class HuggingFaceProvider implements AIProvider {
  name = 'huggingface'
  private token: string
  private modelsByTask: Record<AITask, string> = {
    chat: 'meta-llama/Llama-3.3-70B-Instruct',
    scene_command: 'meta-llama/Llama-3.3-70B-Instruct',
    dialogue: 'meta-llama/Llama-3.3-70B-Instruct',
    quest: 'meta-llama/Llama-3.3-70B-Instruct',
    code: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    classification: 'meta-llama/Llama-3.3-70B-Instruct',
  }
  constructor(token: string) { this.token = token }
  available() { return Boolean(this.token) }
  async complete(opts: AICompletionOptions): Promise<AICompletionResult> {
    const model = this.modelsByTask[opts.task] ?? this.modelsByTask.chat
    const t0 = Date.now()
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await withTimeout(fetch(
          `https://router.huggingface.co/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: opts.messages,
              max_tokens: opts.maxTokens ?? 2048,
              temperature: opts.temperature ?? 0.7,
            }),
          },
        ), 60_000, 'huggingface')
        if (!res.ok) throw new Error(`HF ${res.status}: ${await res.text().catch(() => '')}`)
        const data = (await res.json()) as {
          choices: Array<{ message: { content: string } }>
          usage?: { prompt_tokens: number; completion_tokens: number }
        }
        const text = data.choices[0]?.message?.content ?? ''
        if (!text) throw new Error('Empty HF response')
        breakerSuccess(this.name)
        return {
          text, provider: this.name, model, latencyMs: Date.now() - t0,
          tokensIn: data.usage?.prompt_tokens ?? 0,
          tokensOut: data.usage?.completion_tokens ?? 0,
        }
      } catch (e) {
        lastErr = e
        await sleep(500 * 2 ** attempt) // backoff
      }
    }
    breakerFailure(this.name)
    throw lastErr instanceof Error ? lastErr : new Error('HF provider failed')
  }
}

// ─────────────────────── Manager ───────────────────────

class AIProviderManager {
  private providers: AIProvider[]

  constructor() {
    this.providers = [
      new ZaiProvider(),
      new HuggingFaceProvider(process.env.HF_TOKEN ?? ''),
    ]
  }

  list(): Array<{ name: string; available: boolean }> {
    return this.providers.map((p) => ({ name: p.name, available: p.available() }))
  }

  /** Route by task, honoring circuit breakers, cache and automatic fallback. */
  async complete(opts: AICompletionOptions): Promise<AICompletionResult> {
    // cache uniquement pour les appels quasi déterministes (température basse)
    const key = cacheKey(opts)
    if ((opts.temperature ?? 0.7) <= 0.2) {
      const hit = cacheGet(key)
      if (hit) return hit
    }

    const candidates = this.providers.filter((p) => p.available() && !breakerOpen(p.name))
    if (candidates.length === 0) throw new Error('Tous les fournisseurs IA sont indisponibles (circuit breaker ouvert)')

    let lastErr: unknown = null
    for (const provider of candidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await provider.complete(opts)
          breakerSuccess(provider.name)
          result.estimatedCostUsd = estimateCost(result.tokensIn, result.tokensOut)
          if ((opts.temperature ?? 0.7) <= 0.2) cachePut(key, result)
          void this.track(opts, result, 'OK')
          return result
        } catch (e) {
          lastErr = e
          await sleep(400 * 2 ** attempt)
        }
      }
    }
    breakerFailure(candidates[0]?.name ?? 'none')
    const err = lastErr instanceof Error ? lastErr : new Error('AI request failed')
    void this.track(opts, null, 'ERROR', err.message)
    throw err
  }

  private async track(opts: AICompletionOptions, result: AICompletionResult | null, status: string, error?: string) {
    if (!opts.userId) return
    try {
      await db.aIRequest.create({
        data: {
          userId: opts.userId,
          projectId: opts.projectId ?? null,
          task: opts.task,
          provider: result?.provider ?? 'none',
          model: result?.model ?? null,
          prompt: opts.messages.map((m) => `${m.role}: ${m.content.slice(0, 500)}`).join('\n').slice(0, 4000),
          response: result?.text?.slice(0, 8000) ?? null,
          tokensIn: result?.tokensIn ?? 0,
          tokensOut: result?.tokensOut ?? 0,
          latencyMs: result?.latencyMs ?? 0,
          status,
          error: error ?? null,
        },
      })
    } catch { /* tracking must not break requests */ }
  }
}

let manager: AIProviderManager | null = null
export function getAIManager(): AIProviderManager {
  if (!manager) manager = new AIProviderManager()
  return manager
}
