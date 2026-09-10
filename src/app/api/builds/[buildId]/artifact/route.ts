import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError } from '@/lib/api-utils'
import { getStorage } from '@/lib/storage'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const build = await db.build.findUnique({ where: { id: buildId } })
    if (!build) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, build.projectId, 'VIEWER')
    if (!build.artifactKey) return apiError(404, 'NO_ARTIFACT', 'Aucun artifact pour ce build')

    const storage = getStorage()
    const obj = await storage.get(build.artifactKey)
    if (!obj) return apiError(404, 'STORAGE_MISSING', 'Artifact manquant dans le stockage')

    return new NextResponse(new Uint8Array(obj.data), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(obj.size),
        'Content-Disposition': `attachment; filename="gen3ia-game-${buildId.slice(0, 8)}.html"`,
      },
    })
  } catch (e) {
    return handleApiError(e)
  }
}
