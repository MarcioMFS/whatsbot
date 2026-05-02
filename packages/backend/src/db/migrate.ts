import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Pool({ connectionString: process.env.DATABASE_URL })

const sql = readFileSync(join(__dirname, 'migrations/001_initial.sql'), 'utf-8')
await db.query(sql)
console.log('Migration complete')
await db.end()
