import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { audit, apiError, handleApiError } from '@/lib/api-utils'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const project = await db.project.findUnique({
      where: { id },
      include: { _count: { select: { assets: true, snapshots: true, builds: true, scripts: true } } },
    })
    if (!project) return apiError(404, 'NOT_FOUND', 'Projet introuvable')
    return NextResponse.json({ project })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = await req.json()
    const allowed = ['name', 'description', 'sceneData', 'gameConfig', 'serverConfig', 'aiConfig', 'buildConfig', 'worldConfig', 'autoSave']
    const data: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) data[key] = body[key]
    }
    const project = await db.project.update({ where: { id }, data })
    return NextResponse.json({ project })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'OWNER')
    await db.project.delete({ where: { id } })
    await audit('project.delete', user.id, id, {})
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleApiError(e)
  }
}
