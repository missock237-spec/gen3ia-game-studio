import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'
import { requestCancel } from '@/lib/build-orchestrator'

export async function POST(req: NextRequest, ctx: { params: Promise<{ buildId: string }> }) {
  try {
    const user = await requireUser()
    const { buildId } = await ctx.params
    const build = await db.build.findUnique({ where: { id: buildId } })
    if (!build) return apiError(404, 'NOT_FOUND', 'Build introuvable')
    await requireProjectAccess(user.id, build.projectId, 'EDITOR')
    const result = await requestCancel(buildId)
    await audit('build.cancel', user.id, buildId, result)
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (e) {
    return handleApiError(e)
  }
}
