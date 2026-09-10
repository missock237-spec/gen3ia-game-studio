// Factions NPC — relations/réputation partagées par projet.
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
    const factions = await db.faction.findMany({ where: { projectId: id }, orderBy: { name: 'asc' } })
    return NextResponse.json({ factions: factions.map((f) => ({ ...f, relations: JSON.parse(f.relations || '{}') })) })
  } catch (e) {
    return handleApiError(e)
  }
}

const upsertSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#9aa5b1'),
  // { "NomFaction": -100..100 }
  relations: z.record(z.string(), z.number().min(-100).max(100)).default({}),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = upsertSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Faction invalide')
    const faction = await db.faction.upsert({
      where: { projectId_name: { projectId: id, name: body.data.name } },
      create: { projectId: id, name: body.data.name, color: body.data.color, relations: JSON.stringify(body.data.relations) },
      update: { color: body.data.color, relations: JSON.stringify(body.data.relations) },
    })
    await audit('faction.upsert', user.id, faction.id, { name: body.data.name })
    return NextResponse.json({ faction: { ...faction, relations: body.data.relations } }, { status: 201 })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const name = req.nextUrl.searchParams.get('name') ?? ''
    if (!name) return apiError(400, 'VALIDATION', 'Nom requis')
    await db.faction.deleteMany({ where: { projectId: id, name } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleApiError(e)
  }
}
