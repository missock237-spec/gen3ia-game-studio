import { NextRequest, NextResponse } from 'next/server'
import { getStorage, verifyLocalSignature } from '@/lib/storage'

/**
 * Public read endpoint for locally-stored objects behind an HMAC-signed URL.
 * Mirrors R2 presigned URLs: expiry + integrity without a DB session.
 * GET /api/storage/builds/<id>/artifacts/<file>?expires=<ms>&signature=<hmac>
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params
  const key = parts.map(decodeURIComponent).join('/')
  const expires = Number(req.nextUrl.searchParams.get('expires') ?? 0)
  const signature = req.nextUrl.searchParams.get('signature') ?? ''
  if (!expires || !signature || !verifyLocalSignature(key, expires, signature)) {
    return NextResponse.json({ error: { code: 'SIGNATURE_INVALID', message: 'URL signée invalide ou expirée' } }, { status: 403 })
  }
  const storage = getStorage()
  const obj = await storage.get(key)
  if (!obj) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Objet introuvable' } }, { status: 404 })
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  const mime = ext === 'html' ? 'text/html; charset=utf-8'
    : ext === 'zip' ? 'application/zip'
    : ext === 'json' ? 'application/json'
    : 'application/octet-stream'
  return new NextResponse(new Uint8Array(obj.data), {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, max-age=300',
    },
  })
}
