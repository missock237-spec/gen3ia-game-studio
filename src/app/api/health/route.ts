import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({
      status: 'ok',
      service: 'GEN3IA GAME STUDIO API',
      database: 'connected',
      time: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { status: 'degraded', database: 'error', message: e instanceof Error ? e.message : 'unknown' },
      { status: 503 },
    )
  }
}
