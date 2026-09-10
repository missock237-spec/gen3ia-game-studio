import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit, rateLimit } from '@/lib/api-utils'
import { getStorage, assetKindFromMime, sanitizeKey, getProjectUsageBytes, PROJECT_QUOTA_BYTES } from '@/lib/storage'

const MAX_SIZE = 100 * 1024 * 1024 // 100 MB

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const assets = await db.asset.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, folder: true, kind: true, mimeType: true, size: true,
        checksum: true, metadata: true, corrupted: true, createdAt: true, updatedAt: true, version: true,
      },
    })
    return NextResponse.json({ assets })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const rl = rateLimit(`asset-upload:${user.id}`, 60, 60_000)
    if (!rl.ok) return apiError(429, 'RATE_LIMITED', 'Trop d\'uploads simultanés')

    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return apiError(400, 'VALIDATION', 'Fichier manquant')
    if (file.size > MAX_SIZE) return apiError(413, 'FILE_TOO_LARGE', `Fichier trop volumineux (max ${MAX_SIZE / 1024 / 1024} MB — utilisez l'upload multipart)`)
    const usage = await getProjectUsageBytes(id)
    if (usage + file.size > PROJECT_QUOTA_BYTES) {
      return apiError(413, 'QUOTA_EXCEEDED', 'Quota de stockage du projet dépassé')
    }
    const folder = (form.get('folder') as string) || '/'

    const buffer = Buffer.from(await file.arrayBuffer())
    // integrity: sha256 checksum
    const checksum = createHash('sha256').update(buffer).digest('hex')
    const mime = file.type || 'application/octet-stream'
    const kind = assetKindFromMime(mime, file.name)

    // magic-byte validation for images — MISMATCH REJETÉ (anti content-type spoofing)
    let corrupted = false
    if (mime.startsWith('image/')) {
      const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50
      const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8
      const isGif = buffer.length > 6 && buffer.slice(0, 3).toString() === 'GIF'
      const isWebp = buffer.length > 12 && buffer.slice(8, 12).toString() === 'WEBP'
      const ext = file.name.toLowerCase().split('.').pop()
      const svg = ext === 'svg' && buffer.slice(0, 100).toString().includes('<svg')
      if (!svg && !['ktx2', 'hdr'].includes(ext ?? '')) {
        corrupted = !(isPng || isJpg || isGif || isWebp)
        if (corrupted) {
          return apiError(415, 'UNSUPPORTED_MEDIA', 'Fichier rejeté : type image déclaré mais magic bytes non reconnus (PNG/JPG/GIF/WEBP attendu)')
        }
      }
      // SVG : jamais de script embarqué (anti-XSS) — rejet strict
      if (svg) {
        const head = buffer.slice(0, 4096).toString().toLowerCase()
        if (head.includes('<script') || head.includes('onload=') || head.includes('onclick=') || head.includes('javascript:')) {
          return apiError(415, 'UNSUPPORTED_MEDIA', 'SVG rejeté : script ou handler d\'événement détecté')
        }
      }
    }

    const storage = getStorage()
    const key = sanitizeKey(`projects/${id}/${kind}/${checksum}/${file.name}`.replace(/\/+/g, '/'))
    await storage.put(key, buffer, mime)

    const metadata: Record<string, unknown> = { originalName: file.name }
    if (mime.startsWith('image/')) {
      metadata.width = null
      metadata.height = null
    }

    // upsert by (project, folder, name)
    const existing = await db.asset.findFirst({ where: { projectId: id, folder, name: file.name } })
    const asset = existing
      ? await db.asset.update({
        where: { id: existing.id },
        data: { mimeType: mime, size: buffer.length, checksum, storageKey: key, provider: storage.name, corrupted, version: existing.version + 1, kind, metadata: JSON.stringify(metadata) },
      })
      : await db.asset.create({
        data: {
          projectId: id, name: file.name, folder, kind, mimeType: mime,
          size: buffer.length, checksum, storageKey: key, provider: storage.name,
          corrupted, metadata: JSON.stringify(metadata),
        },
      })

    await audit('asset.upload', user.id, asset.id, { name: file.name, size: buffer.length, provider: storage.name })
    return NextResponse.json({
      asset: { ...asset, metadata: asset.metadata },
      integrity: { checksum, corrupted },
    }, { status: existing ? 200 : 201 })
  } catch (e) {
    return handleApiError(e)
  }
}
