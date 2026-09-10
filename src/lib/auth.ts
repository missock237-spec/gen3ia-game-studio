// Auth — real JWT sessions (jose) + scrypt password hashing (node:crypto).
import { SignJWT, jwtVerify } from 'jose'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'gen3ia_session'
const SESSION_DAYS = 14

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'dev-only-insecure-secret-change-me'
  return new TextEncoder().encode(secret)
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  avatarColor: string
}

export async function createSession(user: { id: string; email: string; name: string; role: string }, userAgent?: string): Promise<void> {
  const raw = new TextEncoder().encode(randomBytes(32).toString('hex'))
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  const jwt = await new SignJWT({ sub: user.id, email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(secretKey())

  await db.session.create({
    data: { tokenHash: sha256(jwt), userId: user.id, expiresAt: expires, userAgent: userAgent?.slice(0, 200) },
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  })
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: sha256(token) } })
  }
  cookieStore.delete(SESSION_COOKIE)
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, secretKey())
    // check session not revoked/expired
    const session = await db.session.findUnique({ where: { tokenHash: sha256(token) } })
    if (!session || session.expiresAt < new Date()) return null
    const user = await db.user.findUnique({ where: { id: payload.sub as string } })
    if (!user) return null
    return { id: user.id, email: user.email, name: user.name, role: user.role, avatarColor: user.avatarColor }
  } catch {
    return null
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new AuthError('Authentification requise', 401)
  return user
}

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.status = status
  }
}

// ─────────────────────── RBAC ───────────────────────

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER'

export async function projectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) return null
  if (project.ownerId === userId) return 'OWNER'
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })
  return (member?.role as ProjectRole) ?? null
}

export async function requireProjectAccess(userId: string, projectId: string, min: ProjectRole): Promise<ProjectRole> {
  const role = await projectRole(userId, projectId)
  if (!role) throw new AuthError('Projet introuvable ou accès refusé', 404)
  const order: ProjectRole[] = ['VIEWER', 'EDITOR', 'OWNER']
  if (order.indexOf(role) < order.indexOf(min)) throw new AuthError('Permissions insuffisantes', 403)
  return role
}
