import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError } from '@/lib/api-utils'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const scripts = await db.scriptFile.findMany({
      where: { projectId: id },
      orderBy: { path: 'asc' },
      select: { id: true, path: true, language: true, content: true, updatedAt: true },
    })
    return NextResponse.json({ scripts })
  } catch (e) {
    return handleApiError(e)
  }
}

const createSchema = z.object({
  path: z.string().regex(/^[\w/-]+\.([tj]sx?|glsl|wgsl|json)$/, 'Chemin invalide (ex: scripts/player.ts)'),
  content: z.string().max(200_000).default(''),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = createSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Chemin invalide')
    const language = body.data.path.endsWith('.glsl') || body.data.path.endsWith('.wgsl') ? 'glsl'
      : body.data.path.endsWith('.json') ? 'json' : 'typescript'
    const script = await db.scriptFile.create({
      data: { projectId: id, path: body.data.path, content: body.data.content, language },
    })
    return NextResponse.json({ script }, { status: 201 })
  } catch (e) {
    return handleApiError(e)
  }
}
