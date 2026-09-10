import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { apiError, handleApiError, rateLimit } from '@/lib/api-utils'
import { getAIManager } from '@/lib/ai'
import { aiCommandPayloadSchema, sceneCommandSchema, type SceneCommand } from '@/engine/types'

const bodySchema = aiCommandPayloadSchema.extend({
  mode: z.enum(['chat', 'command']).default('command'),
})

const SYSTEM_COMMANDS = `Tu es l'assistant IA de GEN3IA GAME STUDIO, un éditeur de jeux 3D.
Ta mission: transformer la demande de l'utilisateur en commandes STRUCTURÉES JSON pour modifier une scène 3D.

Réponds UNIQUEMENT avec un objet JSON valide de cette forme:
{"reply": "<phrase courte en français expliquant ce que tu as fait>", "commands": [ ... ]}

Types de commandes disponibles:
1. {"op": "addEntity", "entity": {"name": "...", "components": {...}}}
   Composants possibles dans entity.components:
   - mesh: {"kind": "box"|"sphere"|"cylinder"|"cone"|"plane"|"capsule"|"torus", "params": {"width":1,"height":1,"depth":1}}
   - material: {"color": "#hex", "metalness": 0-1, "roughness": 0-1, "opacity": 0-1}
   - light: {"kind": "directional"|"point"|"spot"|"ambient", "color": "#hex", "intensity": 0-50, "castShadow": true}
   - transform: {"position": {"x":0,"y":0,"z":0}, "rotation": {"x":0,"y":0,"z":0}, "scale": {"x":1,"y":1,"z":1}}
   - rigidBody: {"type": "static"|"dynamic", "mass": 10}
   - collider: {"shape": "box"|"sphere", "isTrigger": false}
   - npc: {"archetype": "civilian"|"guard"|"merchant"|"hostile"|"companion", "personality": "...", "faction": "...", "aggression": 0-1, "moveSpeed": 2, "patrolRadius": 6, "goals": ["patrol"]}
   - particleEmitter: {"count": 100, "color": "#hex", "speed": 3, "lifetime": 1.5}
   - health: {"max": 100, "current": 100}
   - script: {"enabled": true, "source": "function onUpdate(ctx, dt) {...}"}
2. {"op": "modifyEntity", "entityId": "e_xxx", "patch": {...composants partiels...}}
3. {"op": "deleteEntity", "entityId": "e_xxx"}
4. {"op": "duplicateEntity", "entityId": "e_xxx", "count": N}
5. {"op": "setEnvironment", "environment": {"ambientColor": "#hex", "ambientIntensity": 0.5}}

Règles:
- Le tableau "commands" peut contenir 1 à 50 commandes.
- Pour créer plusieurs objets similaires (ex: 10 arbres), émets plusieurs addEntity avec des positions différentes.
- Les ids d'entités existants sont fournis dans le résumé de scène.
- Reste concis dans "reply" (1-2 phrases).`

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = rateLimit(`ai:${user.id}`, 30, 60_000)
    if (!rl.ok) return apiError(429, 'RATE_LIMITED', `Limite IA atteinte. Réessayez dans ${rl.retryAfter}s`)

    const body = bodySchema.safeParse(await req.json())
    if (!body.success) return apiError(400, 'VALIDATION', 'Message invalide')

    const ai = getAIManager()
    const projectId = req.headers.get('x-project-id') ?? undefined

    const messages = [
      { role: 'system' as const, content: body.data.mode === 'command' ? SYSTEM_COMMANDS : 'Tu es l\'assistant de développement de GEN3IA GAME STUDIO. Réponds en français, de façon concise et technique.' },
      ...(body.data.sceneSummary ? [{ role: 'system' as const, content: `État actuel de la scène:\n${body.data.sceneSummary.slice(0, 20000)}` }] : []),
      { role: 'user' as const, content: body.data.message },
    ]

    const result = await ai.complete({
      task: body.data.mode === 'command' ? 'scene_command' : 'chat',
      messages,
      userId: user.id,
      projectId,
      temperature: 0.4,
      maxTokens: 4000,
    })

    if (body.data.mode === 'chat') {
      return NextResponse.json({ reply: result.text, provider: result.provider, model: result.model })
    }

    // command mode: parse structured output, validate every command
    let parsed: { reply?: string; commands?: unknown[] }
    try {
      const cleaned = result.text.replace(/```json|```/g, '').trim()
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      parsed = JSON.parse(cleaned.slice(start, end + 1))
      // Défense : certains modèles encapsulent tout le JSON dans "reply".
      // Si aucune commande mais que "reply" est lui-même du JSON → re-parse.
      if (
        (!parsed.commands || (Array.isArray(parsed.commands) && parsed.commands.length === 0)) &&
        typeof parsed.reply === 'string' &&
        parsed.reply.trim().startsWith('{')
      ) {
        try {
          const inner = JSON.parse(parsed.reply.replace(/```json|```/g, '').trim())
          if (inner && Array.isArray(inner.commands)) parsed = inner
        } catch { /* on garde le parse externe */ }
      }
    } catch {
      return NextResponse.json({
        reply: result.text.slice(0, 2000),
        commands: [],
        provider: result.provider,
        warning: 'Réponse IA non structurée — affichée comme texte',
      })
    }

    const validCommands: SceneCommand[] = []
    const invalid: string[] = []
    for (const raw of (parsed.commands ?? []).slice(0, 100)) {
      const check = sceneCommandSchema.safeParse(raw)
      if (check.success) validCommands.push(check.data)
      else invalid.push(JSON.stringify(raw).slice(0, 120))
    }

    return NextResponse.json({
      reply: parsed.reply ?? 'Commandes générées.',
      commands: validCommands,
      invalidCommands: invalid,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
    })
  } catch (e) {
    return handleApiError(e)
  }
}
