// NPC CRUD — persistance des PNJ (personnalité, schedule, dialogue, faction).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit, rateLimit, clientIp } from '@/lib/api-utils'

const npcCreateSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(['villager', 'guard', 'merchant', 'monster', 'quest_giver']).default('villager'),
  factionId: z.string().optional().nullable(),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }).default({ x: 0, y: 0, z: 0 }),
  personality: z.record(z.string(), z.number()).default({}),
  schedule: z.array(z.object({
    time: z.string().max(8),
    activity: z.string().max(40),
    location: z.object({ x: z.number(), y: z.number(), z: z.number() }).default({ x: 0, y: 0, z: 0 }),
  })).max(24).default([]),
  dialogue: z.record(z.string(), z.string()).default({}),
  homePos: z.object({ x: z.number(), y: z.number(), z: z.number() }).default({ x: 0, y: 0, z: 0 }),
})

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const npcs = await db.nPC.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
      include: { memories: { orderBy: { createdAt: 'desc' }, take: 5 } },
    })
    return NextResponse.json({ npcs })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const ip = clientIp(req)
    const rl = rateLimit(`npc-create:${user.id}`, 30, 60_000)
    if (!rl.ok) return apiError(429, 'RATE_LIMITED', 'Trop de créations de NPC')

    const body = npcCreateSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Données invalides')

    if (body.data.factionId) {
      const faction = await db.faction.findFirst({ where: { id: body.data.factionId, projectId: id } })
      if (!faction) return apiError(404, 'NOT_FOUND', 'Faction introuvable pour ce projet')
    }

    const npc = await db.nPC.create({
      data: {
        projectId: id,
        name: body.data.name,
        kind: body.data.kind,
        factionId: body.data.factionId ?? null,
        position: JSON.stringify(body.data.position),
        personality: JSON.stringify(body.data.personality),
        schedule: JSON.stringify(body.data.schedule),
        dialogue: JSON.stringify(body.data.dialogue),
        homePos: JSON.stringify(body.data.homePos),
      },
    })
    await audit('npc.create', user.id, npc.id, { name: npc.name, kind: npc.kind }, ip)
    return NextResponse.json({ npc }, { status: 201 })
  } catch (e) {
    return handleApiError(e)
  }
}
