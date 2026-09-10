// Test E2E multijoueur : 2 clients socket.io, join même room, mouvement,
// snapshot serveur, anti-cheat vitesse, reconnexion via sessionToken.
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const PROJECT = 'cmtvxrvjn000dqdu8soahpicn'

function makeClient(name: string) {
  const s = io(URL, { path: '/mp/', transports: ['websocket'] })
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name}: timeout join`)), 8000)
    s.on('connect', () => {
      s.emit('join', { projectId: PROJECT, zone: 'default', name })
    })
    s.on('joined', (data: any) => {
      clearTimeout(t)
      resolve({ socket: s, name, data })
    })
    s.on('connect_error', (e: Error) => { clearTimeout(t); reject(e) })
  })
}

async function main() {
  console.log('[1] Connexion de 2 clients…')
  const a = await makeClient('Alice')
  console.log('  Alice joined:', JSON.stringify(a.data).slice(0, 140))
  const b = await makeClient('Bob')
  console.log('  Bob joined:', JSON.stringify(b.data).slice(0, 140))

  console.log('[2] Mouvement autorisé (vitesse normale)…')
  let lastSnap: any = null
  a.socket.on('snapshot', (snap: any) => { lastSnap = snap })
  b.socket.emit('state', { x: 5, z: 0, ry: 0 })
  await new Promise(r => setTimeout(r, 1200))

  console.log('[3] Anti-cheat : téléportation (x: 500) — doit être clampée par le serveur…')
  b.socket.emit('state', { x: 500, z: 0, ry: 0 })
  await new Promise(r => setTimeout(r, 800))
  const bobInSnap = (lastSnap?.players ?? []).find((p: any) => p.name === 'Bob')
  const bobX = bobInSnap ? Number(bobInSnap.x) : NaN
  const clamped = Number.isFinite(bobX) && bobX < 100
  console.log('  Bob visible dans les snapshots d\'Alice:', !!bobInSnap)
  console.log(`  position x de Bob après téléport: ${bobX} → clampée: ${clamped}`)

  console.log('[4] Déconnexion + reconnexion via sessionToken…')
  const tokenB = b.data.sessionToken
  b.socket.disconnect()
  await new Promise(r => setTimeout(r, 300))
  const b2 = io(URL, { path: '/mp/', transports: ['websocket'] })
  const reconnected = await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout reconnect')), 8000)
    b2.on('connect', () => b2.emit('join', { projectId: PROJECT, zone: 'default', name: 'Bob', sessionToken: tokenB }))
    b2.on('joined', (data: any) => { clearTimeout(t); resolve(data) })
  })
  const samePlayer = reconnected.playerId === b.data.playerId
  console.log('  même playerId restauré:', samePlayer)

  a.socket.disconnect()
  b2.disconnect()
  const ok = !!bobInSnap && clamped && samePlayer
  console.log(ok ? '✅ MULTIPLAYER E2E OK' : '❌ MULTIPLAYER E2E ÉCHEC')
  process.exit(ok ? 0 : 1)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
