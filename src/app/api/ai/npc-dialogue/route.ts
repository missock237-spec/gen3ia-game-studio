// NPC dialogue via LLM — with server-side cache + cooldown (cost control).
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { handleApiError, apiError } from '@/lib/api-utils'
import { getAIManager } from '@/lib/ai'

interface CacheEntry {
  line: string
  at: number
}

const cache = new Map<string, CacheEntry>()
const COOLDOWN_MS = 20_000
const CACHE_TTL_MS = 120_000

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const body = await req.json().catch(() => ({}))
    const npcName = typeof body.npcName === 'string' ? body.npcName.slice(0, 80) : 'PNJ'
    const playerMessage = typeof body.message === 'string' ? body.message.slice(0, 500) : ''
    const persona = typeof body.persona === 'string' ? body.persona.slice(0, 500) : ''

    const key = `${npcName}:${playerMessage || 'greet'}`
    const cached = cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ line: cached.line, cached: true })
    }

    const lastCall = [...cache.values()].sort((a, b) => b.at - a.at)[0]
    if (lastCall && Date.now() - lastCall.at < COOLDOWN_MS) {
      return NextResponse.json({ line: null, cooldown: true })
    }

    const ai = getAIManager()
    const result = await ai.complete({
      task: 'dialogue',
      userId: user.id,
      temperature: 0.9,
      maxTokens: 120,
      messages: [
        { role: 'system', content: `Tu incarne un PNJ de jeu vidéo nommé ${npcName}. ${persona ? `Personnalité: ${persona}.` : ''} Réponds par UNE réplique courte (max 2 phrases) de dialogue de jeu, en français, sans guillemets ni narration.` },
        { role: 'user', content: playerMessage || 'Le joueur t\'aborde et te salue.' },
      ],
    })

    cache.set(key, { line: result.text, at: Date.now() })
    return NextResponse.json({ line: result.text, cached: false, provider: result.provider })
  } catch (e) {
    return handleApiError(e)
  }
}
