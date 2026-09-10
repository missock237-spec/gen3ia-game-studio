// Multiplayer server info — proxies the game server (mini-service, port 3003).
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-utils'

export async function GET() {
  try {
    const res = await fetch('http://127.0.0.1:3103/stats', { cache: 'no-store' })
    if (!res.ok) throw new Error(`game server ${res.status}`)
    const data = await res.json()
    return NextResponse.json({ online: true, ...data })
  } catch {
    return NextResponse.json({
      online: false,
      rooms: [],
      note: 'Serveur de jeu (multiplayer) non démarré — lancez le mini-service game-server',
    })
  }
}
