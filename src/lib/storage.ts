// Storage Adapter — Local disk (default) + Cloudflare R2 (S3-compatible).
// Contract: put/get/delete/head + signedUrl (short-lived) + multipart (resumable
// large uploads). Big binaries NEVER live in PostgreSQL — only references.
import crypto from 'crypto'
import { mkdir, readFile, writeFile, unlink, stat, rm } from 'fs/promises'
import path from 'path'
import { AwsClient } from 'aws4fetch'
import { db } from '@/lib/db'

export interface StoredObject {
  data: Buffer
  size: number
}

export interface MultipartSession {
  uploadId: string
  key: string
}

export interface StorageAdapter {
  readonly name: 'local' | 'r2'
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
  head(key: string): Promise<{ size: number } | null>
  /** URL the browser can read directly (null = stream via authenticated API) */
  publicUrl(key: string): Promise<string | null>
  /** short-lived signed GET URL (local: HMAC token route; R2: SigV4 presigned) */
  signedUrl(key: string, expiresSec: number): Promise<string | null>
  // resumable / multipart for large files
  createMultipart(key: string, contentType: string): Promise<MultipartSession>
  uploadPart(key: string, uploadId: string, partNumber: number, data: Buffer): Promise<{ etag: string }>
  completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void>
  abortMultipart(key: string, uploadId: string): Promise<void>
}

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'assets')
const MULTIPART_ROOT = path.join(process.cwd(), 'storage', 'multipart')

/** Prevent path traversal — keys are sanitized to [a-zA-Z0-9._/-] */
export function sanitizeKey(key: string): string {
  const clean = key.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\.\.+/g, '_')
  if (clean.startsWith('/')) return clean.slice(1)
  return clean
}

function signingSecret(): string {
  return process.env.AUTH_SECRET || 'gen3ia-dev-signing-secret'
}

/** HMAC signature for local signed URLs — verifies key + expiry, no DB hit. */
export function signLocalKey(key: string, expiresAtMs: number): string {
  return crypto.createHmac('sha256', signingSecret()).update(`${key}:${expiresAtMs}`).digest('hex')
}

export function verifyLocalSignature(key: string, expiresAtMs: number, signature: string): boolean {
  if (Date.now() > expiresAtMs) return false
  const expected = signLocalKey(key, expiresAtMs)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

class LocalDiskStorage implements StorageAdapter {
  readonly name = 'local' as const
  async put(key: string, data: Buffer): Promise<void> {
    const full = path.join(STORAGE_ROOT, sanitizeKey(key))
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, data)
  }
  async get(key: string): Promise<StoredObject | null> {
    try {
      const full = path.join(STORAGE_ROOT, sanitizeKey(key))
      const data = await readFile(full)
      return { data, size: data.length }
    } catch {
      return null
    }
  }
  async delete(key: string): Promise<void> {
    try { await unlink(path.join(STORAGE_ROOT, sanitizeKey(key))) } catch { /* already gone */ }
  }
  async head(key: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(path.join(STORAGE_ROOT, sanitizeKey(key)))
      return { size: s.size }
    } catch { return null }
  };
  async publicUrl(): Promise<string | null> { return null } // streamed via API
  async signedUrl(key: string, expiresSec: number): Promise<string | null> {
    const exp = Date.now() + expiresSec * 1000
    return `/api/storage/${sanitizeKey(key).split('/').map(encodeURIComponent).join('/')}?expires=${exp}&signature=${signLocalKey(key, exp)}`
  }
  // multipart = part files, concatenated at completion
  async createMultipart(key: string): Promise<MultipartSession> {
    const uploadId = crypto.randomBytes(16).toString('hex')
    const dir = path.join(MULTIPART_ROOT, uploadId)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'key'), sanitizeKey(key))
    return { uploadId, key: sanitizeKey(key) }
  }
  async uploadPart(_key: string, uploadId: string, partNumber: number, data: Buffer): Promise<{ etag: string }> {
    const dir = path.join(MULTIPART_ROOT, sanitizeKey(uploadId))
    await mkdir(dir, { recursive: true })
    const etag = crypto.createHash('md5').update(data).digest('hex')
    await writeFile(path.join(dir, `part-${String(partNumber).padStart(5, '0')}`), data)
    return { etag }
  }
  async completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
    const dir = path.join(MULTIPART_ROOT, sanitizeKey(uploadId))
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    const buffers: Buffer[] = []
    for (const p of ordered) {
      buffers.push(await readFile(path.join(dir, `part-${String(p.partNumber).padStart(5, '0')}`)))
    }
    await this.put(key, Buffer.concat(buffers))
    await rm(dir, { recursive: true, force: true })
  }
  async abortMultipart(_key: string, uploadId: string): Promise<void> {
    await rm(path.join(MULTIPART_ROOT, sanitizeKey(uploadId)), { recursive: true, force: true })
  }
}

class R2Storage implements StorageAdapter {
  readonly name = 'r2' as const
  private client: AwsClient
  private endpoint: string
  private bucket: string

  constructor(accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey })
    this.bucket = bucket
    this.endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  }

  private url(key: string): string {
    return `${this.endpoint}/${this.bucket}/${sanitizeKey(key)}`
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), {
      method: 'PUT',
      body: new Uint8Array(data),
      headers: { 'Content-Type': contentType },
    })
    if (!res.ok) throw new Error(`R2 put failed: ${res.status} ${await res.text().catch(() => '')}`)
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.client.fetch(this.url(key))
    if (!res.ok) return null
    const data = Buffer.from(await res.arrayBuffer())
    return { data, size: data.length }
  }

  async delete(key: string): Promise<void> {
    await this.client.fetch(this.url(key), { method: 'DELETE' })
  }

  async head(key: string): Promise<{ size: number } | null> {
    const res = await this.client.fetch(this.url(key), { method: 'HEAD' })
    if (!res.ok) return null
    return { size: Number(res.headers.get('content-length') ?? 0) }
  }

  async publicUrl(): Promise<string | null> { return null } // use signedUrl instead

  /** SigV4 presigned GET (query auth) — short-lived, CDN-cacheable. */
  async signedUrl(key: string, expiresSec: number): Promise<string | null> {
    try {
      const req = new Request(this.url(key), { method: 'GET' })
      const signed = await this.client.sign(req, {
        aws: { signQuery: true },
        headers: {},
      } as RequestInit & { aws: Record<string, unknown> })
      const url = new URL(signed.url)
      url.searchParams.set('X-Amz-Expires', String(Math.min(expiresSec, 604800)))
      return url.toString()
    } catch {
      return null
    }
  }

  async createMultipart(key: string, contentType: string): Promise<MultipartSession> {
    const res = await this.client.fetch(`${this.url(key)}?uploads`, { method: 'POST', headers: { 'Content-Type': contentType } })
    if (!res.ok) throw new Error(`R2 createMultipart failed: ${res.status}`)
    const xml = await res.text()
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1]
    if (!uploadId) throw new Error('R2 createMultipart: UploadId manquant')
    return { uploadId, key: sanitizeKey(key) }
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, data: Buffer): Promise<{ etag: string }> {
    const res = await this.client.fetch(`${this.url(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`, {
      method: 'PUT',
      body: new Uint8Array(data),
    })
    if (!res.ok) throw new Error(`R2 uploadPart failed: ${res.status}`)
    const etag = (res.headers.get('etag') ?? '').replace(/"/g, '')
    return { etag }
  }

  async completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${[...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>&quot;${p.etag}&quot;</ETag></Part>`)
      .join('')}</CompleteMultipartUpload>`
    const res = await this.client.fetch(`${this.url(key)}?uploadId=${encodeURIComponent(uploadId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    })
    if (!res.ok) throw new Error(`R2 completeMultipart failed: ${res.status}`)
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.fetch(`${this.url(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'DELETE' })
  }
}

let cached: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (cached) return cached
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET } = process.env
  if (CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_R2_ACCESS_KEY_ID && CLOUDFLARE_R2_SECRET_ACCESS_KEY && CLOUDFLARE_R2_BUCKET) {
    cached = new R2Storage(CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET)
  } else {
    cached = new LocalDiskStorage()
  }
  return cached
}

/** Per-project storage usage (bytes) — used to enforce quotas. */
/** Per-project storage usage (bytes) — used to enforce quotas. */
export async function getProjectUsageBytes(projectId: string): Promise<number> {
  const agg = await db.asset.aggregate({ where: { projectId }, _sum: { size: true } })
  return agg._sum.size ?? 0
}

export const PROJECT_QUOTA_BYTES = Number(process.env.PROJECT_QUOTA_BYTES ?? 2 * 1024 * 1024 * 1024) // 2 Go

export function assetKindFromMime(mime: string, filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (mime.startsWith('image/')) return 'texture'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (['glb', 'gltf', 'fbx', 'obj'].includes(ext)) return 'model'
  if (['js', 'ts', 'tsx'].includes(ext)) return 'script'
  if (['glsl', 'vert', 'frag', 'wgsl'].includes(ext)) return 'shader'
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font'
  if (ext === 'json') return 'json'
  if (ext === 'hdr') return 'texture'
  if (ext === 'ktx2') return 'texture'
  return 'other'
}
