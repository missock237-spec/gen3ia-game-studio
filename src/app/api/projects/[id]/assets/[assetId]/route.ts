import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'
import { getStorage } from '@/lib/storage'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireUser()
    const { id, assetId } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const asset = await db.asset.findUnique({ where: { id: assetId } })
    if (!asset || asset.projectId !== id) return apiError(404, 'NOT_FOUND', 'Asset introuvable')
    return NextResponse.json({ asset })
  } catch (e) {
    return handleApiError(e)
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  folder: z.string().max(200).optional(),
  metadata: z.string().max(20000).optional(),
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireUser()
    const { id, assetId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = patchSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', 'Données invalides')
    const asset = await db.asset.update({ where: { id: assetId }, data: body.data })
    await audit('asset.update', user.id, assetId, { name: body.data.name })
    return NextResponse.json({ asset })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireUser()
    const { id, assetId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const asset = await db.asset.findUnique({ where: { id: assetId } })
    if (!asset || asset.projectId !== id) return apiError(404, 'NOT_FOUND', 'Asset introuvable')
    const storage = getStorage()
    await storage.delete(asset.storageKey)
    await db.asset.delete({ where: { id: assetId } })
    await audit('asset.delete', user.id, assetId, { name: asset.name })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleApiError(e)
  }
}
