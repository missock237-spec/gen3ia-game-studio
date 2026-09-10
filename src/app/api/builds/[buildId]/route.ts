import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError } from '@/lib/api-utils'
import { syncBuild, requestCancel } from '@/lib/build-orchestrator'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const build = await db.build.findUnique({ where: { id: buildId } })
    if (!build) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, build.projectId, 'VIEWER')
    // follow up cloud builds (github actions / google cloud build) on poll
    await syncBuild(buildId)
    const fresh = await db.build.findUnique({
      where: { id: buildId },
      include: { artifacts: { orderBy: { createdAt: 'asc' } } },
    })
    return NextResponse.json({ build: fresh })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const build = await db.build.findUnique({ where: { id: buildId } })
    if (!build) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, build.projectId, 'EDITOR')
    if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(build.status)) {
      const result = await requestCancel(buildId)
      return NextResponse.json(result, { status: result.ok ? 200 : 409 })
    }
    return NextResponse.json({ ok: false, status: build.status, message: 'Build non annulable dans son état actuel' })
  } catch (e) {
    return handleApiError(e)
  }
}
