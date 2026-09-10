// Google Cloud auth — service account JWT → OAuth2 access token, plus GCS
// upload via the XML API. No external dependency (node:crypto RS256).
import crypto from 'crypto'
import fs from 'fs'

export interface ServiceAccountKey {
  client_email: string
  private_key: string
  project_id: string
}

export function loadServiceAccount(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_CLOUD_CREDENTIALS // JSON inline (recommandé en prod)
  if (raw) {
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8').trimStart().startsWith('{')
        ? Buffer.from(raw, 'base64').toString('utf8')
        : raw) as ServiceAccountKey
      if (parsed.client_email && parsed.private_key) return parsed
    } catch { /* fallthrough to file */ }
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ServiceAccountKey
      if (parsed.client_email && parsed.private_key) return parsed
    } catch { /* invalid file */ }
  }
  return null
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let cachedToken: { token: string; expiresAt: number } | null = null

/** Exchange a signed JWT for an OAuth2 access token (cached until expiry). */
export async function getAccessToken(sa: ServiceAccountKey, scope: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  const iat = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = base64url(signer.sign(sa.private_key))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text().catch(() => '')}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cachedToken.token
}

/** Upload a tarball to GCS via the XML API (Bearer token). Returns object name. */
export async function uploadToGCS(bucket: string, objectName: string, data: Buffer, contentType: string): Promise<string> {
  const sa = loadServiceAccount()
  if (!sa) throw new Error('Service account Google indisponible')
  const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/devstorage.read_write https://www.googleapis.com/auth/cloud-platform')
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: new Uint8Array(data),
  })
  if (!res.ok) throw new Error(`GCS upload failed: ${res.status} ${await res.text().catch(() => '')}`)
  return objectName
}
