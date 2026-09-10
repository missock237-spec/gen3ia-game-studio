import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError } from '@/lib/api-utils'
import { syncGitHubBuild } from '@/lib/build-orchestrator'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const build = await db.build.findUnique({ where: { id: buildId } })
    if (!build) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, build.projectId, 'VIEWER')
    // track GitHub-triggered builds on poll
    await syncGitHubBuild(buildId)
    const fresh = await db.build.findUnique({ where: { id: buildId } })
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
    if (build.status === 'QUEUED' || build.status === 'VALIDATING' || build.status === 'BUILDING') {
      await db.build.update({ where: { id: buildId }, data: { status: 'CANCELLED', completedAt: new Date() } })
      return NextResponse.json({ ok: true, status: 'CANCELLED' })
    }
    return NextResponse.json({ ok: false, status: build.status, message: 'Build non annulable dans son état actuel' })
  } catch (e) {
    return handleApiError(e)
  }
}
