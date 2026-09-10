import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { rateLimit, clientIp, audit, apiError, handleApiError } from '@/lib/api-utils'
import { createStarterScene } from '@/engine/scene'

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  template: z.enum(['empty', 'starter']).default('starter'),
})

export async function GET() {
  try {
    const user = await requireUser()
    const projects = await db.project.findMany({
      where: { ownerId: user.id, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { assets: true, snapshots: true, builds: true } } },
    })
    return NextResponse.json({ projects })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const ip = clientIp(req)
    const rl = rateLimit(`project-create:${user.id}`, 20, 60_000)
    if (!rl.ok) return apiError(429, 'RATE_LIMITED', 'Trop de créations de projets')

    const body = createSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Données invalides')

    const scene = createStarterScene()
    const sceneData = body.data.template === 'starter'
      ? scene.toJSON()
      : JSON.stringify({
        version: 1, name: 'Main Scene', entities: {}, rootOrder: [],
        environment: { ambientColor: '#8899bb', ambientIntensity: 0.55, shadowsEnabled: true, postProcessing: true },
        worldConfig: { cellSize: 100, streamingEnabled: false },
      })

    const project = await db.project.create({
      data: {
        name: body.data.name,
        description: body.data.description,
        ownerId: user.id,
        sceneData,
        gameConfig: JSON.stringify({}),
        serverConfig: JSON.stringify({ maxPlayers: 64, tickRate: 20, region: 'eu-west' }),
        buildConfig: JSON.stringify({ targets: ['web'], profile: 'release' }),
      },
    })
    await db.projectMember.create({
      data: { projectId: project.id, userId: user.id, role: 'OWNER' },
    })
    await db.snapshot.create({
      data: { projectId: project.id, label: 'Création du projet', kind: 'MANUAL', sceneData },
    })
    await audit('project.create', user.id, project.id, { name: project.name }, ip)
    return NextResponse.json({ project }, { status: 201 })
  } catch (e) {
    return handleApiError(e)
  }
}
