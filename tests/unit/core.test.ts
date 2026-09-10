// Tests unitaires GEN3IA GAME STUDIO — bun test ./tests/
// @ts-expect-error — types bun:test fournis via bun-types au runtime bun
import { describe, expect, test } from 'bun:test'
import { sceneDocumentSchema } from '../../src/engine/types'
import { sanitizeKey, signLocalKey, verifyLocalSignature } from '../../src/lib/storage'
import { sha256 } from '../../src/lib/build/local'
import { requiredEnvForProvider } from '../../src/lib/build/types'

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
