// NPC individuel — mise à jour + mémoire (persistance NPC AI, Phase 17).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'

const npcUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: z.enum(['villager', 'guard', 'merchant', 'monster', 'quest_giver']).optional(),
  factionId: z.string().nullable().optional(),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  personality: z.record(z.string(), z.number()).optional(),
  dialogue: z.record(z.string(), z.string()).optional(),
})

const memorySchema = z.object({
  kind: z.enum(['event', 'meeting', 'combat', 'trade', 'quest']),
  subject: z.string().min(1).max(120),
  sentiment: z.number().int().min(-100).max(100).default(0),
  importance: z.number().int().min(1).max(10).default(5),
  summary: z.string().min(1).max(500),
  ttlMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
})

async function loadNpc(npcId: string, projectId: string) {
  return db.nPC.findFirst({ where: { id: npcId, projectId } })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; npcId: string }> }) {
  try {
    const user = await requireUser()
    const { id, npcId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const npc = await loadNpc(npcId, id)
    if (!npc) return apiError(404, 'NOT_FOUND', 'NPC introuvable')

    const body = npcUpdateSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Données invalides')

    const updated = await db.nPC.update({
      where: { id: npcId },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.kind !== undefined ? { kind: body.data.kind } : {}),
        ...(body.data.factionId !== undefined ? { factionId: body.data.factionId } : {}),
        ...(body.data.position !== undefined ? { position: JSON.stringify(body.data.position) } : {}),
        ...(body.data.personality !== undefined ? { personality: JSON.stringify(body.data.personality) } : {}),
        ...(body.data.dialogue !== undefined ? { dialogue: JSON.stringify(body.data.dialogue) } : {}),
      },
    })
    await audit('npc.update', user.id, npcId, {})
    return NextResponse.json({ npc: updated })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; npcId: string }> }) {
  try {
    const user = await requireUser()
    const { id, npcId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const npc = await loadNpc(npcId, id)
    if (!npc) return apiError(404, 'NOT_FOUND', 'NPC introuvable')
    await db.nPC.delete({ where: { id: npcId } })
    await audit('npc.delete', user.id, npcId, { name: npc.name })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleApiError(e)
  }
}

// ───────────────── mémoire NPC (persistance long terme) ─────────────────

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; npcId: string }> }) {
  try {
    const user = await requireUser()
    const { id, npcId } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const npc = await loadNpc(npcId, id)
    if (!npc) return apiError(404, 'NOT_FOUND', 'NPC introuvable')

    const body = memorySchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Mémoire invalide')

    const memory = await db.nPCMemory.create({
      data: {
        npcId,
        kind: body.data.kind,
        subject: body.data.subject,
        sentiment: body.data.sentiment,
        importance: body.data.importance,
        summary: body.data.summary,
        expiresAt: body.data.ttlMinutes ? new Date(Date.now() + body.data.ttlMinutes * 60_000) : null,
      },
    })
    await audit('npc.memory', user.id, npcId, { kind: body.data.kind, subject: body.data.subject })
    return NextResponse.json({ memory }, { status: 201 })
  } catch (e) {
    return handleApiError(e)
  }
}
