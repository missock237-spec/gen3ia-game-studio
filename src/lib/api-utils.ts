// Rate limiting (sliding window, in-memory) + audit logging + API error helper.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface Bucket {
  timestamps: number[]
}

const buckets = new Map<string, Bucket>()
let lastSweep = Date.now()

function sweep() {
  const now = Date.now()
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < 120_000)
    if (bucket.timestamps.length === 0) buckets.delete(key)
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfter: number } {
  sweep()
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) { bucket = { timestamps: [] }; buckets.set(key, bucket) }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs)
  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0]
    return { ok: false, remaining: 0, retryAfter: Math.ceil((windowMs - (now - oldest)) / 1000) }
  }
  bucket.timestamps.push(now)
  return { ok: true, remaining: limit - bucket.timestamps.length, retryAfter: 0 }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'local'
}

// ─────────────────────── Audit ───────────────────────

export async function audit(
  action: string,
  userId: string | null,
  target: string | null,
  meta: Record<string, unknown> = {},
  ip?: string,
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        action,
        userId,
        target,
        meta: JSON.stringify(meta),
        ip: ip ?? null,
      },
    })
  } catch {
    // audit must never break the request path
  }
}

// ─────────────────────── API error helper ───────────────────────

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status })
}

export function handleApiError(e: unknown, fallbackCode = 'INTERNAL_ERROR') {
  if (e instanceof Error && 'status' in e) {
    const status = (e as { status: number }).status
    return apiError(status, fallbackCode, e.message)
  }
  return apiError(500, fallbackCode, e instanceof Error ? e.message : 'Erreur interne')
}
