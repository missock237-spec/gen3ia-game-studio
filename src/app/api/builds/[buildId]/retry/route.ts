import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'
import { runBuild } from '@/lib/build-orchestrator'

/**
 * Retry a FAILED or CANCELLED build.
 * Creates a new build record with the same target/profile/version
 * (attempt = previous attempt + 1) and launches the real pipeline.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const prev = await db.build.findUnique({ where: { id: buildId } })
    if (!prev) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, prev.projectId, 'EDITOR')

    if (!['FAILED', 'CANCELLED'].includes(prev.status)) {
      return apiError(409, 'NOT_RETRYABLE', `Seuls les builds FAILED ou CANCELLED peuvent être relancés (actuel: ${prev.status})`)
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const build = await db.build.create({
      data: {
        projectId: prev.projectId,
        userId: user.id,
        target: prev.target,
        profile: prev.profile,
        version: prev.version,
        provider: prev.provider,
        status: 'QUEUED',
        attempt: prev.attempt + 1,
      },
    })
    await audit('build.retry', user.id, build.id, { retriedFrom: prev.id, target: prev.target }, ip)
    void runBuild(build.id)
    return NextResponse.json({ build }, { status: 202 })
  } catch (e) {
    return handleApiError(e)
  }
}
