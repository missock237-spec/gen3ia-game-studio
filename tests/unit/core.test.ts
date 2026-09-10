// Tests unitaires GEN3IA GAME STUDIO — bun test ./tests/
// @ts-expect-error — types bun:test fournis via bun-types au runtime bun
import { describe, expect, test } from 'bun:test'
import { sceneDocumentSchema } from '../../src/engine/types'
import { sanitizeKey, signLocalKey, verifyLocalSignature } from '../../src/lib/storage'
import { sha256 } from '../../src/lib/build/local'
import { requiredEnvForProvider } from '../../src/lib/build/types'
import { repairJson } from '../../src/lib/json-repair'

function validScene() {
  return {
    version: 1 as const,
    name: 'Test Scene',
    entities: {
      e1: {
        id: 'e1', name: 'Ground', parentId: null, visible: true, locked: false,
        tags: [], layer: 0, isStatic: true,
        components: {
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          mesh: { kind: 'box', params: { width: 10, height: 1, depth: 10 } },
        },
      },
    },
    rootOrder: ['e1'],
    environment: { ambientColor: '#8899bb', ambientIntensity: 0.55, shadowsEnabled: true, postProcessing: true },
    worldConfig: { cellSize: 100, streamingEnabled: false },
  }
}

describe('Scène — validation Zod', () => {
  test('scène valide acceptée', () => {
    const r = sceneDocumentSchema.safeParse(validScene())
    expect(r.success).toBe(true)
  })
  test('rootOrder manquante rejetée', () => {
    const s = validScene() as Record<string, unknown>
    delete s.rootOrder
    expect(sceneDocumentSchema.safeParse(s).success).toBe(false)
  })
  test('version invalide rejetée', () => {
    const s = { ...validScene(), version: 2 }
    expect(sceneDocumentSchema.safeParse(s).success).toBe(false)
  })
  test('entité sans transform acceptée (composants optionnels)', () => {
    const base = validScene()
    const e1 = base.entities.e1
    const s = JSON.parse(JSON.stringify(base)) as ReturnType<typeof validScene>
    ;(s.entities as Record<string, typeof e1>).e2 = { ...e1, id: 'e2', name: 'Empty', components: {} as typeof e1['components'] }
    s.rootOrder.push('e2')
    expect(sceneDocumentSchema.safeParse(s).success).toBe(true)
  })
})

describe('Stockage — sécurité des clés', () => {
  test('sanitizeKey bloque le path traversal', () => {
    expect(sanitizeKey('../../etc/passwd')).not.toContain('..')
    expect(sanitizeKey('/abs/path').startsWith('/')).toBe(false)
  })
  test('URLs signées locales : validité + expiration', () => {
    const key = 'builds/abc/game.html'
    const exp = Date.now() + 60_000
    const sig = signLocalKey(key, exp)
    expect(verifyLocalSignature(key, exp, sig)).toBe(true)
    expect(verifyLocalSignature(key, exp, 'bad')).toBe(false)
    const expired = Date.now() - 120_000
    expect(verifyLocalSignature(key, expired, signLocalKey(key, expired))).toBe(false)
    expect(verifyLocalSignature('other-key', exp, sig)).toBe(false)
  })
})

describe('Builds — checksums & fournisseurs', () => {
  test('sha256 déterministe', () => {
    expect(sha256(Buffer.from('gen3ia'))).toBe(sha256(Buffer.from('gen3ia')))
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')))
  })
  test('env requises par fournisseur documentées', () => {
    expect(requiredEnvForProvider('google-cloud-build')).toContain('GOOGLE_CLOUD_PROJECT')
    expect(requiredEnvForProvider('github-actions')).toContain('GITHUB_TOKEN')
    expect(requiredEnvForProvider('local')).toHaveLength(0)
  })
})

describe('IA — réparation JSON malformé', () => {
  test('JSON malformé (accolade manquante) réparé', () => {
    // cas réel observé : le modèle a omis une accolade fermante
    const bad = '{"reply": "ok", "commands": [{"op": "addEntity", "entity": {"name": "Sphere", "components": {"transform": {"position": {"x": 0, "y": 5, "z": 0}}}}]}'
    const parsed = repairJson(bad) as { commands: { op: string }[] }
    expect(Array.isArray(parsed.commands)).toBe(true)
    expect(parsed.commands.length).toBe(1)
    expect(parsed.commands[0].op).toBe('addEntity')
  })
  test('JSON encapsulé dans reply (double encodage) réparé', () => {
    const inner = JSON.stringify({ reply: 'fait', commands: [{ op: 'deleteEntity', entityId: 'x' }] })
    const outer = JSON.stringify({ reply: inner, commands: [] })
    const parsed = repairJson(outer) as { reply: string }
    expect(typeof parsed.reply).toBe('string')
    const inner2 = repairJson(parsed.reply) as { commands: unknown[] }
    expect(inner2.commands.length).toBe(1)
  })
  test('virgule traînante réparée', () => {
    const bad = '{"a": 1, "b": [1, 2,]}'
    const parsed = repairJson(bad) as { a: number; b: number[] }
    expect(parsed.a).toBe(1)
    expect(parsed.b.length).toBe(2)
  })
  test('sortie tronquée (maxTokens) récupère le préfixe valide', () => {
    const full = '{"reply": "r", "commands": [{"op": "addEntity", "entity": {"name": "A"}}, {"op": "addEntity", "entity": {"name": "B"}}]}'
    const truncated = full.slice(0, full.indexOf('"B"') - 2) // coupe en plein milieu
    const parsed = repairJson(truncated) as { commands?: unknown[] } | null
    expect(parsed).not.toBeNull()
    expect(parsed!.commands!.length).toBeGreaterThanOrEqual(1)
  })
  test('texte sans JSON → null (aucune invention)', () => {
    expect(repairJson('Bonjour, je ne peux pas faire cela.')).toBeNull()
    expect(repairJson('')).toBeNull()
  })
  test('JSON valide intact', () => {
    const good = '{"reply": "x", "commands": []}'
    expect(repairJson(good)).toEqual({ reply: 'x', commands: [] })
  })
})
