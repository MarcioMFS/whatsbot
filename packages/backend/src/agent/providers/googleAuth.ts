import { createSign } from 'crypto'
import { readFileSync } from 'fs'

// Service-account → OAuth2 access token for Vertex AI. Ported from Vox.
// No google-auth-library: sign an RS256 JWT and exchange it. Token cached.
// sa.json path via GOOGLE_SA_PATH (client_email + private_key).

let cache: { token: string; expiresAt: number } | null = null

export async function getGoogleAccessToken(): Promise<string | null> {
  if (cache && Date.now() < cache.expiresAt - 30_000) return cache.token
  try {
    const saPath = process.env.GOOGLE_SA_PATH ?? `${process.cwd()}/sa.json`
    const sa = JSON.parse(readFileSync(saPath, 'utf-8')) as { client_email: string; private_key: string }
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })).toString('base64url')
    const sign = createSign('RSA-SHA256')
    sign.update(`${header}.${payload}`)
    const signature = sign.sign(sa.private_key, 'base64url')
    const jwt = `${header}.${payload}.${signature}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    })
    if (!res.ok) { console.error('[agent] Google token error:', await res.text()); return null }
    const { access_token, expires_in } = await res.json() as { access_token: string; expires_in: number }
    cache = { token: access_token, expiresAt: Date.now() + expires_in * 1000 }
    return access_token
  } catch (e) {
    console.error('[agent] Google auth error:', e instanceof Error ? e.message : e)
    return null
  }
}
