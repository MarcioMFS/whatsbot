import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

interface AuthCtx {
  db: Pool
}

export async function authRoutes(app: FastifyInstance, ctx: AuthCtx) {
  const { db } = ctx

  app.post('/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const { email, password, name } = parsed.data

    const hash = await bcrypt.hash(password, 12)
    const id = randomUUID()

    try {
      await db.query(
        'INSERT INTO users (id, email, password_hash, name) VALUES ($1,$2,$3,$4)',
        [id, email, hash, name]
      )
    } catch {
      return reply.code(409).send({ error: 'Email already registered' })
    }

    const token = app.jwt.sign({ id, email })
    return reply.code(201).send({ token, user: { id, email, name } })
  })

  app.post('/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const { email, password } = parsed.data
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email])
    if (!rows[0]) return reply.code(401).send({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, rows[0].password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ id: rows[0].id, email })
    return { token, user: { id: rows[0].id, email, name: rows[0].name } }
  })
}
