import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError } from '@/lib/api-utils'
import { getStorage } from '@/lib/storage'

/** Streams asset bytes to the browser (with checksum verification support). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireUser()
    const { id, assetId } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const asset = await db.asset.findUnique({ where: { id: assetId } })
    if (!asset || asset.projectId !== id) return apiError(404, 'NOT_FOUND', 'Asset introuvable')

    const storage = getStorage()
    const obj = await storage.get(asset.storageKey)
    if (!obj) return apiError(404, 'STORAGE_MISSING', 'Fichier manquant dans le stockage')

    const body = new Uint8Array(obj.data)
    return new NextResponse(body, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(obj.size),
        'Cache-Control': 'private, max-age=3600',
        'X-Checksum-Sha256': asset.checksum,
        'Content-Disposition': `inline; filename="${encodeURIComponent(asset.name)}"`,
      },
    })
  } catch (e) {
    return handleApiError(e)
  }
}
