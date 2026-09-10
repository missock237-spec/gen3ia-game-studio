// Scene chunks — streaming du monde. Chaque chunk = cellule (cx, cz) de la
// grille worldConfig.cellSize, avec ses entités + params de terrain éventuels.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import { apiError, handleApiError, audit } from '@/lib/api-utils'
import { getProjectUsageBytes } from '@/lib/storage'

const chunkDataSchema = z.object({
  entities: z.array(z.record(z.string(), z.unknown())).max(500),
})

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'VIEWER')
    const cx = req.nextUrl.searchParams.get('cx')
    const cz = req.nextUrl.searchParams.get('cz')
    if (cx !== null && cz !== null) {
      const chunk = await db.sceneChunk.findUnique({
        where: { projectId_cx_cz: { projectId: id, cx: Number(cx), cz: Number(cz) } },
      })
      if (!chunk) return apiError(404, 'NOT_FOUND', 'Chunk introuvable')
      return NextResponse.json({ chunk: { ...chunk, data: JSON.parse(chunk.data || '{}'), terrain: JSON.parse(chunk.terrain || '{}') } })
    }
    const chunks = await db.sceneChunk.findMany({
      where: { projectId: id },
      orderBy: [{ cx: 'asc' }, { cz: 'asc' }],
      select: { id: true, cx: true, cz: true, name: true, entityCount: true, sizeBytes: true, updatedAt: true },
      take: 400,
    })
    return NextResponse.json({ chunks })
  } catch (e) {
    return handleApiError(e)
  }
}

const upsertSchema = z.object({
  cx: z.number().int().min(-4096).max(4096),
  cz: z.number().int().min(-4096).max(4096),
  name: z.string().max(80).default(''),
  entities: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  terrain: z.record(z.string(), z.unknown()).default({}),
})

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const body = upsertSchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Chunk invalide')
    const check = chunkDataSchema.safeParse({ entities: body.data.entities })
    if (!check.success) return apiError(400, 'VALIDATION', 'Entités de chunk invalides')

    const data = JSON.stringify({ entities: body.data.entities })
    const sizeBytes = Buffer.byteLength(data)
    if (sizeBytes > 4 * 1024 * 1024) return apiError(413, 'CHUNK_TOO_LARGE', 'Chunk > 4 Mo — subdivisez la cellule')

    const chunk = await db.sceneChunk.upsert({
      where: { projectId_cx_cz: { projectId: id, cx: body.data.cx, cz: body.data.cz } },
      create: {
        projectId: id, cx: body.data.cx, cz: body.data.cz, name: body.data.name,
        data, terrain: JSON.stringify(body.data.terrain),
        entityCount: body.data.entities.length, sizeBytes,
      },
      update: {
        name: body.data.name, data, terrain: JSON.stringify(body.data.terrain),
        entityCount: body.data.entities.length, sizeBytes,
      },
    })
    await audit('chunk.save', user.id, chunk.id, { cx: body.data.cx, cz: body.data.cz, entities: body.data.entities.length })
    void getProjectUsageBytes // (quotas assets gérés ailleurs)
    return NextResponse.json({ chunk: { ...chunk, data: JSON.parse(chunk.data), terrain: JSON.parse(chunk.terrain) } })
  } catch (e) {
    return handleApiError(e)
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await requireProjectAccess(user.id, id, 'EDITOR')
    const cx = Number(req.nextUrl.searchParams.get('cx'))
    const cz = Number(req.nextUrl.searchParams.get('cz'))
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return apiError(400, 'VALIDATION', 'cx/cz requis')
    await db.sceneChunk.deleteMany({ where: { projectId: id, cx, cz } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleApiError(e)
  }
}
