import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, rateLimit, audit } from '@/lib/api-utils'
import { runBuild, syncAllActiveBuilds } from '@/lib/build-orchestrator'

const startSchema = z.object({
  target: z.enum(['web', 'android', 'windows', 'linux', 'dedicated-server', 'github']),
  profile: z.enum(['debug', 'release']).default('release'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version sémantique attendue (ex: 1.0.0)').default('1.0.0'),
})

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    // follow up cloud builds (github actions / cloud build) before answering
    await syncAllActiveBuilds(id)
    const builds = await db.build.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { artifacts: { orderBy: { createdAt: 'desc' } } },
    })
    return NextResponse.json({ builds })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const rl = rateLimit(`build:${user.id}`, 10, 60_000)
    if (!rl.ok) return apiError(429, 'RATE_LIMITED', 'Trop de builds — patientez un instant')

    const body = startSchema.safeParse(await req.json())
    if (!body.success) {
      return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Cible invalide')
    }

    const project = await db.project.findUnique({ where: { id }, select: { sceneData: true } })
    if (!project) return apiError(404, 'NOT_FOUND', 'Projet introuvable')

    const build = await db.build.create({
      data: {
        projectId: id,
        userId: user.id,
        target: body.data.target,
        profile: body.data.profile,
        version: body.data.version,
        provider: ['web', 'dedicated-server'].includes(body.data.target) ? 'local' : 'github-actions',
        status: 'QUEUED',
      },
    })
    await audit('build.start', user.id, build.id, {
      target: body.data.target, version: body.data.version, profile: body.data.profile,
    })

    // run the real pipeline asynchronously (same process), returns immediately
    void runBuild(build.id)

    return NextResponse.json({ build }, { status: 202 })
  } catch (e) {
    return handleApiError(e)
  }
}
