// Proxy HTTP engine.io/socket.io → game-server (:3003, path /mp/).
// Le navigateur ne peut pas joindre directement le port du game-server
// derrière la passerelle : ce route handler transporte le transport
// POLLING de socket.io (GET long-poll + POST) vers le serveur de jeu.
// WebSocket upgrade non traversable ici — le client utilise polling ;
// en déploiement direct (docker/VPS), les clients joignent :3003 nativement.
const UPSTREAM = process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3003'

async function proxy(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    // la query engine.io (EIO, transport, sid, t…) est transmise telle quelle
    const target = `${UPSTREAM}/mp/${url.search}`
    const headers: HeadersInit = { 'cache': 'no-store' }
    if (req.headers.get('content-type')) {
      ;(headers as Record<string, string>)['content-type'] = req.headers.get('content-type') as string
    }
    const body = req.method === 'POST' ? await req.arrayBuffer() : undefined
    const res = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    })
    return new Response(res.body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'text/plain; charset=utf-8',
        'cache-control': 'no-store, no-transform',
      },
    })
  } catch {
    return Response.json(
      { error: { code: 'GAME_SERVER_UNREACHABLE', message: 'Serveur de jeu injoignable — vérifiez GAME_SERVER_URL / mini-services/game-server' } },
      { status: 502 },
    )
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // long-polling engine.io

export { proxy as GET, proxy as POST }
