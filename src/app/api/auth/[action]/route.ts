import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { createSession, hashPassword, verifyPassword, getSessionUser, destroySession } from '@/lib/auth'
import { rateLimit, clientIp, audit, apiError, handleApiError } from '@/lib/api-utils'

const registerSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(200),
})

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  const ip = clientIp(req)
  try {
    if (action === 'register') {
      const rl = rateLimit(`register:${ip}`, 5, 60_000)
      if (!rl.ok) return apiError(429, 'RATE_LIMITED', `Trop de tentatives. Réessayez dans ${rl.retryAfter}s`)
      const body = registerSchema.safeParse(await req.json())
      if (!body.success) return apiError(400, 'VALIDATION', body.error.issues[0]?.message ?? 'Données invalides')
      const { email, name, password } = body.data

      const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } })
      if (existing) return apiError(409, 'EMAIL_TAKEN', 'Un compte existe déjà avec cet email')

      const colors = ['#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']
      const user = await db.user.create({
        data: {
          email: email.toLowerCase(),
          name,
          passwordHash: hashPassword(password),
          avatarColor: colors[Math.floor(Math.random() * colors.length)],
        },
      })
      await createSession(user, req.headers.get('user-agent') ?? undefined)
      await audit('auth.register', user.id, user.id, {}, ip)
      return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, avatarColor: user.avatarColor } })
    }

    if (action === 'login') {
      const rl = rateLimit(`login:${ip}`, 10, 60_000)
      if (!rl.ok) return apiError(429, 'RATE_LIMITED', `Trop de tentatives. Réessayez dans ${rl.retryAfter}s`)
      const body = loginSchema.safeParse(await req.json())
      if (!body.success) return apiError(400, 'VALIDATION', 'Email ou mot de passe invalide')
      const { email, password } = body.data
      const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
      if (!user || !verifyPassword(password, user.passwordHash)) {
        await audit('auth.login_failed', null, null, { email }, ip)
        return apiError(401, 'BAD_CREDENTIALS', 'Email ou mot de passe incorrect')
      }
      await createSession(user, req.headers.get('user-agent') ?? undefined)
      await audit('auth.login', user.id, user.id, {}, ip)
      return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, avatarColor: user.avatarColor } })
    }

    if (action === 'logout') {
      const user = await getSessionUser()
      await destroySession()
      await audit('auth.logout', user?.id ?? null, null, {}, ip)
      return NextResponse.json({ ok: true })
    }

    return apiError(404, 'NOT_FOUND', 'Action inconnue')
  } catch (e) {
    return handleApiError(e)
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  if (action === 'me') {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ user: null })
    return NextResponse.json({ user })
  }
  return apiError(404, 'NOT_FOUND', 'Action inconnue')
}
