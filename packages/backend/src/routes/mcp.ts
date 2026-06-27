import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { BotRepository, ConversationRepository, LeadRepository, MessagingPort, Bot } from '@whatsbot/core'
import type { AIGenerationService } from '../services/AIGenerationService.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

// WhatsBot MCP (onda 1) — servidor MCP genérico: camada de WhatsApp + contexto.
// Qualquer client (Vox é o 1º) manda/lê COM contexto, sem tocar no Evolution cru.
// Auth = API-key de serviço (mcp_clients), escopada a dono + bots + escopo de tools.
// Ver Brain/Projetos/WhatsBot/spec_whatsbot_mcp.md.

interface McpDeps {
  db: Pool
  botRepo: BotRepository
  conversationRepo: ConversationRepository
  leadRepo: LeadRepository
  messaging: MessagingPort
  aiService: AIGenerationService
}
interface McpClient { id: string; ownerId: string; allowedBots: string[] | null; scopes: string[] }

export async function mcpRoutes(app: FastifyInstance, deps: McpDeps) {
  const authenticate = async (token: string | undefined): Promise<McpClient | null> => {
    if (!token) return null
    const { rows } = await deps.db.query(
      'SELECT id, owner_id, allowed_bots, scopes FROM mcp_clients WHERE token = $1', [token],
    )
    if (!rows[0]) return null
    deps.db.query('UPDATE mcp_clients SET last_used_at = now() WHERE id = $1', [rows[0].id]).catch(() => {})
    return {
      id: rows[0].id as string, ownerId: rows[0].owner_id as string,
      allowedBots: (rows[0].allowed_bots as string[] | null) ?? null,
      scopes: (rows[0].scopes as string[]) ?? ['read'],
    }
  }

  // Escopo + ownership por construção: o token só age nos bots do dono e dentro do escopo concedido.
  const access = async (client: McpClient, botId: string, scope: 'read' | 'send' | 'action'): Promise<Bot> => {
    if (!client.scopes.includes(scope)) throw new Error(`sem permissão (escopo "${scope}" não concedido a este token)`)
    const bot = await deps.botRepo.findById(botId)
    if (!bot || bot.ownerId !== client.ownerId) throw new Error('bot não encontrado')
    if (client.allowedBots && !client.allowedBots.includes(botId)) throw new Error('bot fora do escopo deste token')
    return bot
  }
  const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })
  const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: `erro: ${msg}` }], isError: true })

  const buildServer = (client: McpClient): McpServer => {
    const server = new McpServer({ name: 'whatsbot', version: '1.0.0' })

    server.registerTool('send_message', {
      description: 'Envia uma mensagem de WhatsApp por um bot do WhatsBot (abstrai instância/formato/durabilidade). Requer escopo send.',
      inputSchema: { botId: z.string(), to: z.string().describe('número, formato 5511999999999'), text: z.string() },
    }, async ({ botId, to, text }) => {
      try {
        const bot = await access(client, botId, 'send')
        await deps.messaging.sendMessage({ instanceName: bot.evolutionConfig.instanceName, phoneNumber: to, message: text })
        return ok({ sent: true, botId, to })
      } catch (e) { return fail(e instanceof Error ? e.message : 'falha') }
    })

    server.registerTool('get_conversation_context', {
      description: 'Contexto rico de uma conversa: lead (nome/tags/temperatura/resumo) + estado + histórico recente + pagamento pendente. É a memória que o WhatsBot tem da conversa.',
      inputSchema: { botId: z.string(), phone: z.string(), limit: z.number().optional() },
    }, async ({ botId, phone, limit }) => {
      try {
        await access(client, botId, 'read')
        const [lead, conv] = await Promise.all([
          deps.leadRepo.findByPhone(botId, phone),
          deps.conversationRepo.findActiveByPhone(botId, phone),
        ])
        const n = Math.min(limit ?? 10, 50)
        return ok({
          lead: lead ? { name: lead.name, tags: lead.tags, temperature: lead.leadTemperature, lastState: lead.lastState, summary: lead.contextSummary } : null,
          conversation: conv ? {
            phase: conv.phase, status: conv.status, currentNodeId: conv.currentNodeId,
            pendingPaymentId: conv.variables['__rt_checkout_payment_id'] || conv.variables['paymentIntentId'] || null,
            recentHistory: conv.history.slice(-n).map(m => ({ role: m.role, content: m.content })),
          } : null,
        })
      } catch (e) { return fail(e instanceof Error ? e.message : 'falha') }
    })

    server.registerTool('read_conversation', {
      description: 'Histórico recente cru de uma conversa (sem análise). Requer escopo read.',
      inputSchema: { botId: z.string(), phone: z.string(), limit: z.number().optional() },
    }, async ({ botId, phone, limit }) => {
      try {
        await access(client, botId, 'read')
        const conv = await deps.conversationRepo.findActiveByPhone(botId, phone)
        if (!conv) return ok({ messages: [] })
        const n = Math.min(limit ?? 20, 100)
        return ok({ messages: conv.history.slice(-n).map(m => ({ role: m.role, content: m.content })) })
      } catch (e) { return fail(e instanceof Error ? e.message : 'falha') }
    })

    server.registerTool('summarize_conversation', {
      description: 'Resumo PT-BR da conversa (quem é / o que quer / onde parou / objeções). Usa IA na cadeia free. Requer escopo read.',
      inputSchema: { botId: z.string(), phone: z.string() },
    }, async ({ botId, phone }) => {
      try {
        await access(client, botId, 'read')
        const conv = await deps.conversationRepo.findActiveByPhone(botId, phone)
        if (!conv || conv.history.length === 0) {
          const lead = await deps.leadRepo.findByPhone(botId, phone)
          return ok({ summary: lead?.contextSummary ?? null, source: 'persisted', note: conv ? 'sem histórico ativo' : 'sem conversa ativa' })
        }
        const transcript = conv.history.slice(-30).map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content}`).join('\n')
        const r = await deps.aiService.generateBuilder({
          systemPrompt: 'Você resume conversas de venda no WhatsApp em PT-BR pra um assistente. 3-4 linhas: quem é / o que a pessoa quer / onde parou / objeções ou pendências. Direto. Só o resumo.',
          promptTemplate: `Conversa:\n${transcript}`, history: [], userMessage: 'Resuma.', variables: {}, temperature: 0.3, maxTokens: 400,
        })
        return ok({ summary: r.content.trim(), source: 'live' })
      } catch (e) { return fail(e instanceof Error ? e.message : 'falha') }
    })

    server.registerTool('get_lead_intelligence', {
      description: 'Perfil do lead: tags, temperatura, resumo, último estado, PIX abandonado, último pagamento. Requer escopo read.',
      inputSchema: { botId: z.string(), phone: z.string() },
    }, async ({ botId, phone }) => {
      try {
        await access(client, botId, 'read')
        const lead = await deps.leadRepo.findByPhone(botId, phone)
        if (!lead) return ok({ found: false })
        return ok({ found: true, name: lead.name, tags: lead.tags, temperature: lead.leadTemperature, lastState: lead.lastState, summary: lead.contextSummary, abandonedPixCount: lead.abandonedPixCount, lastPaymentConfirmedAt: lead.lastPaymentConfirmedAt })
      } catch (e) { return fail(e instanceof Error ? e.message : 'falha') }
    })

    server.registerTool('get_conversation_outcome', {
      description: 'Desfecho da última conversa desse telefone (paid/abandoned/escalated/timeout/completed) + GMV + etapa. Requer escopo read.',
      inputSchema: { botId: z.string(), phone: z.string() },
    }, async ({ botId, phone }) => {
      try {
        await access(client, botId, 'read')
        const { rows } = await deps.db.query(
          `SELECT co.outcome, co.gmv_centavos, co.last_phase, co.created_at
           FROM conversation_outcomes co JOIN conversations c ON c.id = co.conversation_id
           WHERE c.bot_id = $1 AND c.phone_number = $2 ORDER BY co.created_at DESC LIMIT 1`, [botId, phone])
        return ok(rows[0] ? { outcome: rows[0].outcome, gmvCentavos: rows[0].gmv_centavos, lastPhase: rows[0].last_phase, at: rows[0].created_at } : { outcome: null, note: 'sem desfecho registrado' })
      } catch (e) { return fail(e instanceof Error ? e.message : 'falha') }
    })

    return server
  }

  // POST /mcp — stateless (1 server+transport por request; tools são request/response).
  app.post('/', async (req, reply) => {
    const authHeader = req.headers['authorization']
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const client = await authenticate(token)
    if (!client) {
      reply.code(401).send({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null })
      return
    }
    const server = buildServer(client)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    reply.raw.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    reply.hijack()
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })
}
