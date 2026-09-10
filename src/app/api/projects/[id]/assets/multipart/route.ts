// Resumable / multipart asset upload — for large files (models, videos, builds).
// Flow: POST create → PUT part (1..N, ≥5 Mo sauf dernier) → POST complete.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'
import { getStorage, getProjectUsageBytes, PROJECT_QUOTA_BYTES, sanitizeKey, assetKindFromMime } from '@/lib/storage'

const sessions = new Map<string, { projectId: string; userId: string; key: string; contentType: string; name: string; folder: string; hashes: string[] }>()

const createSchema = z.object({
  name: z.string().min(1).max(255),
  folder: z.string().max(200).default('/'),
  contentType: z.string().min(3).max(120),
  size: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const op = req.nextUrl.searchParams.get('op')

    // ── complete ──
    if (op === 'complete') {
      const body = z.object({
        uploadId: z.string().min(8).max(80),
        parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(4).max(80) })).min(1),
      }).safeParse(await req.json())
      if (!body.success) return apiError(400, 'VALIDATION', 'Paramètres invalides')
      const session = sessions.get(body.data.uploadId)
      if (!session || session.userId !== user.id) return apiError(404, 'SESSION_NOT_FOUND', 'Session d\'upload introuvable ou expirée')
      const storage = getStorage()
      await storage.completeMultipart(session.key, body.data.uploadId, body.data.parts)
      const head = await storage.head(session.key)
      const size = head?.size ?? 0
      // checksum = sha256 de la concat des hashs de parties (intégrité vérifiable)
      const checksum = crypto.createHash('sha256').update(session.hashes.join('')).digest('hex')
      sessions.delete(body.data.uploadId)

      const asset = await db.asset.create({
        data: {
          projectId: id, name: session.name, folder: session.folder,
          kind: assetKindFromMime(session.contentType, session.name),
          mimeType: session.contentType, size,
          checksum, storageKey: session.key, provider: storage.name,
          metadata: JSON.stringify({ multipart: true, parts: body.data.parts.length }),
        },
      })
      await audit('asset.upload.multipart', user.id, asset.id, { size, parts: body.data.parts.length })
      return NextResponse.json({ asset }, { status: 201 })
    }

    // ── create ──
    const body = createSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Paramètres invalides')
    const usage = await getProjectUsageBytes(id)
    if (usage + body.data.size > PROJECT_QUOTA_BYTES) {
      return apiError(413, 'QUOTA_EXCEEDED', `Quota de stockage dépassé (${Math.round(PROJECT_QUOTA_BYTES / 1e9)} Go par projet)`)
    }
    const storage = getStorage()
    const ext = body.data.name.split('.').pop() ?? 'bin'
    const key = sanitizeKey(`projects/${id}/multipart/${crypto.randomBytes(8).toString('hex')}.${ext}`)
    const session0 = await storage.createMultipart(key, body.data.contentType)
    sessions.set(session0.uploadId, {
      projectId: id, userId: user.id, key, contentType: body.data.contentType,
      name: body.data.name, folder: body.data.folder, hashes: [],
    })
    return NextResponse.json({ uploadId: session0.uploadId, key, provider: storage.name, partSizeMin: 5 * 1024 * 1024 }, { status: 201 })
  } catch (e) {
    return handleApiError(e)
  }
}

/** PUT /api/projects/:id/assets/multipart?uploadId=…&partNumber=1 — binary part. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const uploadId = req.nextUrl.searchParams.get('uploadId') ?? ''
    const partNumber = Number(req.nextUrl.searchParams.get('partNumber') ?? 0)
    if (!uploadId || !partNumber) return apiError(400, 'VALIDATION', 'uploadId et partNumber requis')
    const session = sessions.get(uploadId)
    if (!session || session.projectId !== id || session.userId !== user.id) {
      return apiError(404, 'SESSION_NOT_FOUND', 'Session d\'upload introuvable')
    }
    const data = Buffer.from(await req.arrayBuffer())
    if (data.length === 0) return apiError(400, 'VALIDATION', 'Partie vide')
    const storage = getStorage()
    const { etag } = await storage.uploadPart(session.key, uploadId, partNumber, data)
    session.hashes.push(crypto.createHash('sha256').update(data).digest('hex'))
    return NextResponse.json({ partNumber, etag, size: data.length })
  } catch (e) {
    return handleApiError(e)
  }
}
