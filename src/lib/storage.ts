// Storage Adapter — Local disk (active by default) + Cloudflare R2 (S3-compatible).
// Large uploads go directly through this adapter; R2 enables presigned browser→R2 uploads.
import { mkdir, readFile, writeFile, unlink, stat } from 'fs/promises'
import path from 'path'
import { AwsClient } from 'aws4fetch'

export interface StoredObject {
  data: Buffer
  size: number
}

export interface StorageAdapter {
  readonly name: 'local' | 'r2'
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
  head(key: string): Promise<{ size: number } | null>
  /** URL the browser can use to read the object (null = stream via API) */
  publicUrl(key: string): Promise<string | null>
}

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'assets')

/** Prevent path traversal — keys are sanitized to [a-zA-Z0-9/_-] */
export function sanitizeKey(key: string): string {
  const clean = key.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\.\.+/g, '_')
  if (clean.startsWith('/')) return clean.slice(1)
  return clean
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
  }
  async publicUrl(): Promise<string | null> { return null } // streamed via API
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

  async publicUrl(): Promise<string | null> { return null } // presigned GET could be added
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
