import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError } from '@/lib/api-utils'
import { getStorage } from '@/lib/storage'

/**
 * Download a build artifact.
 * Query ?artifact=<id> selects a specific artifact; default = primary (zip/html).
 * When the storage backend supports it, responds with a short-lived signed URL
 * redirect (R2) ; otherwise streams through the authenticated API (local).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const build = await db.build.findUnique({
      where: { id: buildId },
      include: { artifacts: { orderBy: { createdAt: 'asc' } } },
    })
    if (!build) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, build.projectId, 'VIEWER')

    const wanted = req.nextUrl.searchParams.get('artifact')
    const artifact = wanted
      ? build.artifacts.find((a) => a.id === wanted)
      : build.artifacts.find((a) => a.kind === 'primary' && a.status === 'READY')
    if (!artifact || artifact.status !== 'READY') return apiError(404, 'NO_ARTIFACT', 'Aucun artifact disponible pour ce build')

    const storage = getStorage()
    // signed URL redirect when the backend can produce one (R2 / local HMAC)
    const signed = await storage.signedUrl(artifact.storageKey, 300)
    if (signed) {
      const absolute = new URL(signed, req.nextUrl.origin).toString()
      return NextResponse.redirect(absolute, 302)
    }
    const obj = await storage.get(artifact.storageKey)
    if (!obj) return apiError(404, 'STORAGE_MISSING', 'Artifact manquant dans le stockage')
    return new NextResponse(new Uint8Array(obj.data), {
      headers: {
        'Content-Type': artifact.mimeType,
        'Content-Length': String(obj.size),
        'X-Checksum-SHA256': artifact.checksum,
        'X-Artifact-Version': artifact.version,
        'Content-Disposition': `attachment; filename="${artifact.fileName.replace(/[^\w.-]/g, '_')}"`,
      },
    })
  } catch (e) {
    return handleApiError(e)
  }
}

/** Delete an artifact (soft delete: storage removed, row kept with status DELETED). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const artifactId = req.nextUrl.searchParams.get('artifact')
    if (!artifactId) return apiError(400, 'VALIDATION', 'Paramètre artifact requis')
    const build = await db.build.findUnique({ where: { id: buildId } })
    if (!build) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, build.projectId, 'EDITOR')

    const artifact = await db.buildArtifact.findUnique({ where: { id: artifactId } })
    if (!artifact || artifact.buildId !== buildId) return apiError(404, 'NOT_FOUND', 'Artifact introuvable')
    const storage = getStorage()
    await storage.delete(artifact.storageKey)
    await db.buildArtifact.update({ where: { id: artifactId }, data: { status: 'DELETED' } })
    return NextResponse.json({ ok: true, deleted: artifactId })
  } catch (e) {
    return handleApiError(e)
  }
}
