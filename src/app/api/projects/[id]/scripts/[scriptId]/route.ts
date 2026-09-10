import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError } from '@/lib/api-utils'

const updateSchema = z.object({ content: z.string().max(200_000) })

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; scriptId: string }> }) {
  try {
    const user = await requireUser()
    const { id, scriptId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = updateSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', 'Contenu requis')
    const script = await db.scriptFile.update({ where: { id: scriptId }, data: { content: body.data.content } })
    return NextResponse.json({ script })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; scriptId: string }> }) {
  try {
    const user = await requireUser()
    const { id, scriptId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    await db.scriptFile.delete({ where: { id: scriptId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleApiError(e)
  }
}
