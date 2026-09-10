// Test de charge multijoueur par paliers — Phase 13.
// Paliers 2/10/50/100/300 joueurs. Mesure réelle par palier :
// joins OK, tick rate réel (server), latence E2E (echo via snapshot),
// mémoire RSS, CPU, packet rate, inputs rejetés.
// Usage: bun scripts/load-multiplayer-tiers.ts [paliers...] (défaut 2 10 50 100 300)
import os from 'os'
import { io } from 'socket.io-client'

const URL = process.env.GAME_URL ?? 'http://localhost:3003'
const STATS = process.env.STATS_URL ?? 'http://localhost:3103/stats'
const TIERS = (process.argv[2] ? process.argv.slice(2) : ['2', '10', '50', '100', '300']).map(Number)
const PROJECT = `load-tiers-${Date.now()}`

interface Stats {
  realTickHz: number; totalPlayers: number; totalRejectedInputs: number
  mem: number; totalConnections: number
}

function cpuTotal(): { total: number; idle: number } {
  const cpus = os.cpus()
  let total = 0; let idle = 0
  for (const c of cpus) {
    for (const k of Object.keys(c.times)) total += c.times[k as keyof typeof c.times]
    idle += c.times.idle
  }
  return { total, idle }
}

async function fetchStats(): Promise<Stats> {
  const res = await fetch(STATS)
  return await res.json() as Stats
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Bot { sock: ReturnType<typeof io>; id: string; snapshots: number; latencies: number[] }

async function runTier(n: number): Promise<void> {
  console.log(`\n═══ PALIER ${n} joueurs ═══`)
  const stats0 = await fetchStats()
  const cpu0 = cpuTotal()
  const t0 = Date.now()

  const bots: Bot[] = []
  let joined = 0
  let connectErrors = 0

  // connexions échelonnées (ramp) : max 100 conn/s
  const BATCH = 50
  for (let i = 0; i < n; i += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, n - i) }, (_, k) => i + k)
    await Promise.allSettled(batch.map((idx) => new Promise<void>((resolve) => {
      const sock = io(URL, { transports: ['websocket'], timeout: 15_000 })
      const bot: Bot = { sock, id: '', snapshots: 0, latencies: [] }
      const to = setTimeout(() => { connectErrors++; resolve() }, 15_000)
      sock.on('connect', () => {
        sock.emit('join', { projectId: PROJECT, zone: `zone-${idx % 4}`, name: `Bot-${idx}` }, (resp: { ok?: boolean }) => {
          if (resp?.ok) joined++
          clearTimeout(to)
          resolve()
        })
      })
      sock.on('connect_error', () => { clearTimeout(to); connectErrors++; resolve() })
      sock.on('snapshot', (snap: { t: number; players: unknown[] }) => {
        bot.snapshots++
        const lat = Date.now() - snap.t
        if (lat >= 0 && lat < 5000) bot.latencies.push(lat)
      })
      bots.push(bot)
    })))
    await sleep(500 / (BATCH / 10)) // ramp ~100 conn/s
  }

  // phase active : 10 s avec mouvements (30 Hz max, anti-spam toléré)
  const MOVE_MS = 10_000
  const movers = bots.slice(0, Math.min(n, 100)) // les 100 premiers bougent
  const moveInterval = setInterval(() => {
    for (const bot of movers) {
      bot.sock.emit('state', {
        x: Math.random() * 40, y: 1, z: Math.random() * 40,
        ry: Math.random() * Math.PI * 2, anim: 'run',
      })
    }
  }, 1000 / 30)

  await sleep(MOVE_MS)
  clearInterval(moveInterval)

  // mesures
  const stats1 = await fetchStats()
  const cpu1 = cpuTotal()
  const wallSec = (Date.now() - t0) / 1000
  const cpuPct = ((cpu1.total - cpu0.total) - (cpu1.idle - cpu0.idle)) / (cpu1.total - cpu0.total) * 100
  const snapshotsPerSec = bots.reduce((s, b) => s + b.snapshots, 0) / wallSec
  const allLat = bots.flatMap((b) => b.latencies).sort((a, b) => a - b)
  const p50 = allLat[Math.floor(allLat.length * 0.5)] ?? -1
  const p95 = allLat[Math.floor(allLat.length * 0.95)] ?? -1
  const rejectedDelta = stats1.totalRejectedInputs - stats0.totalRejectedInputs

  console.log(`  joins OK: ${joined}/${n} (${connectErrors} erreurs)`)
  console.log(`  tick rate réel serveur: ${stats1.realTickHz} Hz`)
  console.log(`  latence E2E snapshots: p50=${p50} ms · p95=${p95} ms`)
  console.log(`  packet rate: ${Math.round(snapshotsPerSec)} snapshots/s reçus (clients)`)
  console.log(`  inputs rejetés (anti-spam): ${rejectedDelta} (sur ~${movers.length * 30 * (MOVE_MS / 1000)} envoyés)`)
  console.log(`  mémoire serveur: ${Math.round(stats1.mem / 1024 / 1024)} Mo RSS`)
  console.log(`  CPU (durant le test): ${cpuPct.toFixed(1)} %`)

  for (const bot of bots) bot.sock.disconnect()
  await sleep(1500)
}

async function main() {
  console.log(`Test de charge par paliers — ${URL} (projets séparés par run)`)
  const results: Array<{ n: number; joined: number; tick: number; p95: number; mem: number; cpu: number }> = []
  for (const n of TIERS) {
    const r = await runTier(n)
    results.push(r)
  }
  console.log('\n═══ RÉCAPITULATIF ═══')
  console.log('paliers testés:', TIERS.join(', '))
  console.log('\nNOTE: ces résultats mesurent UNIQUEMENT ce poste de test.')
  console.log('Aucune affirmation de capacité au-delà des paliers réellement mesurés.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
