import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const snapshots = await db.snapshot.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, label: true, kind: true, createdAt: true },
    })
    return NextResponse.json({ snapshots })
  } catch (e) {
    return handleApiError(e)
  }
}

const createSchema = z.object({ label: z.string().min(1).max(120) })

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = createSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', 'Label requis')
    const project = await db.project.findUnique({ where: { id }, select: { sceneData: true } })
    if (!project) return apiError(404, 'NOT_FOUND', 'Projet introuvable')
    const snapshot = await db.snapshot.create({
      data: { projectId: id, label: body.data.label, kind: 'MANUAL', sceneData: project.sceneData },
    })
    await audit('snapshot.create', user.id, id, { snapshotId: snapshot.id })
    return NextResponse.json({ snapshot }, { status: 201 })
  } catch (e) {
    return handleApiError(e)
  }
}
