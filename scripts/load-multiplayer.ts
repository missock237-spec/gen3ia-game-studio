// Test de charge multijoueur — N connexions socket.io simulées.
// Mesure: connexions/s, joins OK, snapshots reçus, tick serveur.
// Usage: bun scripts/load-multiplayer.ts [N] (défaut 300)
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const N = Number(process.argv[2] ?? 300)
const PROJECT = 'load-test-world'

interface Client { sock: ReturnType<typeof io>; id: string; snapshots: number }

async function main() {
  console.log(`[load] lancement de ${N} clients simulés…`)
  const clients: Client[] = []
  const t0 = Date.now()
  let joined = 0
  let errors = 0

  await Promise.allSettled(Array.from({ length: N }, (_, i) => new Promise<void>((resolve) => {
    const sock = io(URL, { transports: ['websocket'] })
    const c: Client = { sock, id: '', snapshots: 0 }
    const to = setTimeout(() => { errors++; resolve() }, 15_000)
    sock.on('connect', () => {
      sock.emit('join', { projectId: PROJECT, zone: `zone-${i % 4}`, name: `Bot-${i}` })
    })
    sock.on('joined', (d: { you?: { id: string } }) => {
      clearTimeout(to)
      c.id = d.you?.id ?? ''
      joined++
      // chaque bot envoie un input au join puis toutes les 2s
      sock.emit('state', { x: (i % 20) * 2, z: Math.floor(i / 20) * 2, ry: 0 })
      const iv = setInterval(() => sock.emit('state', { x: Math.random() * 40, z: Math.random() * 40 }), 2000)
      sock.on('disconnect', () => clearInterval(iv))
      resolve()
    })
    sock.on('snapshot', () => { c.snapshots++ })
    sock.on('connect_error', () => { clearTimeout(to); errors++; resolve() })
    clients.push(c)
  })))

  const connectMs = Date.now() - t0
  // fenêtre d'observation 6s : distribution des snapshots
  const base = clients.map((c) => c.snapshots)
  await new Promise((r) => setTimeout(r, 6000))
  let withSnapshots = 0
  let snapDelta = 0
  clients.forEach((c, i) => {
    if (c.snapshots > base[i]) withSnapshots++
    snapDelta += c.snapshots - base[i]
  })
  const statsRes = await fetch('http://localhost:3103/stats').then((r) => r.json()) as {
    totalPlayers: number; rooms: Array<{ players: number }>; realTickHz: number
    totalRejectedInputs: number; mem: number
  }

  console.log('──────── RÉSULTATS ────────')
  console.log(`clients lancés:        ${N}`)
  console.log(`joins OK:              ${joined}`)
  console.log(`erreurs:               ${errors}`)
  console.log(`temps connexion total: ${connectMs} ms (${Math.round(N / (connectMs / 1000))}/s)`)
  console.log(`clients recevant des snapshots: ${withSnapshots}/${N}`)
  console.log(`snapshots reçus en 6s: ${snapDelta}`)
  console.log(`serveur — joueurs:     ${statsRes.totalPlayers} | rooms: ${statsRes.rooms.length} | tick réel: ${statsRes.realTickHz} Hz`)
  console.log(`serveur — rejets input: ${statsRes.totalRejectedInputs} | mem: ${Math.round(statsRes.mem / 1e6)} Mo`)

  const ok = joined >= N * 0.95 && withSnapshots >= N * 0.8 && statsRes.realTickHz >= 15
  console.log(ok ? `✅ CHARGE ${N} CLIENTS OK` : '❌ CHARGE INSUFFISANTE')
  for (const c of clients) c.sock.disconnect()
  setTimeout(() => process.exit(ok ? 0 : 1), 500)
}

void main()
