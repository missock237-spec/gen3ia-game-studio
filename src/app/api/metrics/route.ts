// Metrics développeur — agrégats DB + process (dashboard & monitoring).
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { handleApiError } from '@/lib/api-utils'

const startedAt = Date.now()
const multiplayerStatsUrl = process.env.GAME_SERVER_STATS_URL ?? 'http://localhost:3103/stats'

export async function GET() {
  try {
    const user = await requireUser()
    if (user.role !== 'ADMIN') {
      // les non-admins voient uniquement leurs propres chiffres IA
      const [mine, myBuilds] = await Promise.all([
        db.aIRequest.aggregate({
          where: { userId: user.id },
          _count: true, _sum: { tokensIn: true, tokensOut: true }, _avg: { latencyMs: true },
        }),
        db.build.aggregate({ where: { userId: user.id }, _count: true }),
      ])
      return NextResponse.json({
        scope: 'self',
        ai: { requests: mine._count, tokensIn: mine._sum.tokensIn ?? 0, tokensOut: mine._sum.tokensOut ?? 0, avgLatencyMs: Math.round(mine._avg.latencyMs ?? 0) },
        builds: myBuilds._count,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      })
    }

    const since24h = new Date(Date.now() - 24 * 3600 * 1000)
    const [users, projects, assets, builds, buildsByStatus, ai, aiErrors, audits, chunks] = await Promise.all([
      db.user.count(),
      db.project.count(),
      db.asset.aggregate({ _count: true, _sum: { size: true } }),
      db.build.count(),
      db.build.groupBy({ by: ['status'], _count: true }),
      db.aIRequest.aggregate({
        where: { createdAt: { gte: since24h } },
        _count: true, _sum: { tokensIn: true, tokensOut: true }, _avg: { latencyMs: true },
      }),
      db.aIRequest.count({ where: { createdAt: { gte: since24h }, status: 'ERROR' } }),
      db.auditEvent.count({ where: { createdAt: { gte: since24h } } }),
      db.sceneChunk.aggregate({ _count: true, _sum: { sizeBytes: true } }),
    ])
    const mem = process.memoryUsage()
    // CPU réel : temps CPU consommé depuis le démarrage / temps écoulé
    const cpu = process.cpuUsage()
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000)
    const cpuPct = uptimeSec > 0
      ? Math.round(((cpu.user + cpu.system) / 1000 / uptimeSec) * 100)
      : 0
    // game-server réel : stats remontées si joignable (jamais simulées)
    let multiplayer: {
      online: boolean; players?: number; realTickHz?: number
      rooms?: number; memBytes?: number; endpoint: string
    } = { online: false, endpoint: multiplayerStatsUrl }
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500)
      const gs = await fetch(multiplayerStatsUrl, { signal: ctrl.signal, cache: 'no-store' })
      clearTimeout(t)
      if (gs.ok) {
        const s = await gs.json() as { totalPlayers?: number; realTickHz?: number; rooms?: unknown[]; mem?: number }
        multiplayer = {
          online: true,
          players: s.totalPlayers,
          realTickHz: s.realTickHz,
          rooms: Array.isArray(s.rooms) ? s.rooms.length : 0,
          memBytes: s.mem,
          endpoint: multiplayerStatsUrl,
        }
      }
    } catch { /* game-server indisponible — signalé honnêtement */ }
    return NextResponse.json({
      scope: 'admin',
      users, projects,
      assets: { count: assets._count, totalBytes: assets._sum.size ?? 0 },
      builds: { total: builds, byStatus: Object.fromEntries(buildsByStatus.map((b) => [b.status, b._count])) },
      ai24h: {
        requests: ai._count, errors: aiErrors,
        tokensIn: ai._sum.tokensIn ?? 0, tokensOut: ai._sum.tokensOut ?? 0,
        avgLatencyMs: Math.round(ai._avg.latencyMs ?? 0),
        // coût HF estimé ($0.75/M tokens in, $1/M out — borne haute Llama-70B)
        estimatedCostUsd: Math.round((((ai._sum.tokensIn ?? 0) * 0.75 + (ai._sum.tokensOut ?? 0) * 1) / 1_000_000) * 10000) / 10000,
      },
      audit24h: audits,
      world: { chunks: chunks._count, chunkBytes: chunks._sum.sizeBytes ?? 0 },
      multiplayer,
      process: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, cpuPercent: cpuPct, uptimeSec },
    })
  } catch (e) {
    return handleApiError(e)
  }
}
