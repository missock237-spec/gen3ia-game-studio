import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const user = await requireUser()
    const { id, snapshotId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')

    const snapshot = await db.snapshot.findUnique({ where: { id: snapshotId } })
    if (!snapshot || snapshot.projectId !== id) return apiError(404, 'NOT_FOUND', 'Snapshot introuvable')

    // safety snapshot of current state before restore
    const project = await db.project.findUnique({ where: { id }, select: { sceneData: true } })
    if (project) {
      await db.snapshot.create({
        data: { projectId: id, label: 'Avant restauration', kind: 'AUTOSAVE', sceneData: project.sceneData },
      })
    }
    await db.project.update({ where: { id }, data: { sceneData: snapshot.sceneData } })
    await audit('snapshot.restore', user.id, id, { snapshotId })
    return NextResponse.json({ ok: true, sceneData: JSON.parse(snapshot.sceneData) })
  } catch (e) {
    return handleApiError(e)
  }
}
