import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { Conversation } from '@whatsbot/core'
import type { ConversationRepository } from '@whatsbot/core'

const TTL_ACTIVE = 60 * 60 * 24      // 24h for active/waiting
const TTL_SUSPENDED = 60 * 60 * 24 * 7 // 7 days for suspended (intent preserved)
const TIMEOUT_INDEX = 'conv:timeout_queue'

export class RedisConversationRepository implements ConversationRepository {
  constructor(
    private redis: Redis,
    private db: Pool,
  ) {}

  private activeKey(botId: string, phone: string) {
    return `conv:active:${botId}:${phone}`
  }

  private timeoutMember(botId: string, phone: string) {
    return `${botId}:${phone}`
  }

  async findActiveByPhone(botId: string, phoneNumber: string): Promise<Conversation | null> {
    const raw = await this.redis.get(this.activeKey(botId, phoneNumber))
    if (!raw) return null
    return this.toDomain(JSON.parse(raw))
  }

  async findActiveByBotId(botId: string): Promise<Conversation[]> {
    const convs: Conversation[] = []
    let cursor = '0'
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `conv:active:${botId}:*`, 'COUNT', 200)
      cursor = next
      if (keys.length) {
        const raws = await this.redis.mget(...keys)
        for (const raw of raws) if (raw) convs.push(this.toDomain(JSON.parse(raw)))
      }
    } while (cursor !== '0')
    return convs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async findById(id: string): Promise<Conversation | null> {
    const { rows } = await this.db.query('SELECT * FROM conversations WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0].data) : null
  }

  async findTimedOut(): Promise<Conversation[]> {
    const now = Date.now()
    const members = await this.redis.zrangebyscore(TIMEOUT_INDEX, 0, now)
    const convs: Conversation[] = []
    for (const member of members) {
      const colonIdx = member.indexOf(':')
      const botId = member.substring(0, colonIdx)
      const phone = member.substring(colonIdx + 1)
      const raw = await this.redis.get(this.activeKey(botId, phone))
      if (raw) convs.push(this.toDomain(JSON.parse(raw)))
    }
    return convs
  }

  async save(conversation: Conversation): Promise<void> {
    const data = conversation.toJSON()
    const key = this.activeKey(data.botId, data.phoneNumber)
    const member = this.timeoutMember(data.botId, data.phoneNumber)

    if (data.status === 'ended') {
      await this.redis.del(key)
      await this.redis.zrem(TIMEOUT_INDEX, member)
      await this.db.query(
        `INSERT INTO conversations (id, bot_id, phone_number, data, ended_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (id) DO UPDATE SET data=$4, ended_at=NOW()`,
        [data.id, data.botId, data.phoneNumber, JSON.stringify(data)]
      )
    } else if (data.status === 'suspended') {
      await this.redis.setex(key, TTL_SUSPENDED, JSON.stringify(data))
      await this.redis.zrem(TIMEOUT_INDEX, member) // no timeout polling for suspended
    } else if (data.status === 'handoff') {
      await this.redis.setex(key, TTL_ACTIVE, JSON.stringify(data))
      await this.redis.zrem(TIMEOUT_INDEX, member)
    } else {
      await this.redis.setex(key, TTL_ACTIVE, JSON.stringify(data))
      if (data.timeoutAt) {
        await this.redis.zadd(TIMEOUT_INDEX, new Date(data.timeoutAt).getTime(), member)
      } else {
        await this.redis.zrem(TIMEOUT_INDEX, member)
      }
    }
  }

  async findByBotId(botId: string, limit = 50): Promise<Conversation[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM conversations WHERE bot_id = $1 ORDER BY ended_at DESC LIMIT $2',
      [botId, limit]
    )
    return rows.map(r => this.toDomain(r.data))
  }

  private toDomain(data: ReturnType<Conversation['toJSON']>): Conversation {
    return Conversation.reconstitute({
      ...data,
      startedAt: new Date(data.startedAt),
      updatedAt: new Date(data.updatedAt),
      timeoutAt: data.timeoutAt ? new Date(data.timeoutAt) : null,
      history: data.history.map(m => ({ ...m, timestamp: new Date(m.timestamp) })),
    })
  }
}
