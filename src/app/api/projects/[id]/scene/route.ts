import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'
import { sceneDocumentSchema } from '@/engine/types'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const project = await db.project.findUnique({ where: { id }, select: { sceneData: true, updatedAt: true } })
    if (!project) return apiError(404, 'NOT_FOUND', 'Projet introuvable')
    return NextResponse.json({ sceneData: JSON.parse(project.sceneData || '{}'), updatedAt: project.updatedAt })
  } catch (e) {
    return handleApiError(e)
  }
}

const saveSchema = z.object({ sceneData: z.unknown(), snapshot: z.boolean().optional() })

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = saveSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', 'Payload invalide')

    // validate the document structure before persisting
    const parsed = sceneDocumentSchema.safeParse(body.data.sceneData)
    if (!parsed.success) {
      return apiError(400, 'SCENE_INVALID', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    }

    const sceneData = JSON.stringify(body.data.sceneData)
    await db.project.update({ where: { id }, data: { sceneData } })
    if (body.data.snapshot) {
      await db.snapshot.create({
        data: { projectId: id, label: 'Sauvegarde manuelle', kind: 'MANUAL', sceneData },
      })
    }
    await audit('scene.save', user.id, id, { size: sceneData.length })
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() })
  } catch (e) {
    return handleApiError(e)
  }
}
