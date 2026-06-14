import { Conversation, Cart, MODULE_IDS } from '@whatsbot/core'
import type { Bot, MessagingPort, ConversationRepository, LeadRepository, AgentPolicy, AgentTraceRepository } from '@whatsbot/core'
import type { IAgentProvider, AgentMessage, ToolDef, ToolResultMsg } from './providers/types.js'
import { AGENT_TOOLS } from './tools/index.js'
import type { ModuleRegistry } from '../services/ModuleRegistry.js'
import type { AgentTool, ToolContext, ToolServices } from './tools/types.js'

const MAX_STEPS = 6
const HISTORY_LIMIT = 12

// Default policy — financeiro sensível OFF por padrão (o lab liga o que precisa).
const POLICY_DEFAULTS: Record<string, boolean> = {
  can_generate_pix: true, can_validate_proof: true, can_deliver_access: true, can_transfer_human: true,
  can_apply_discount: false, can_refund: false, can_cancel_order: false,
}

function toolAllowed(bot: Bot, tool: AgentTool): boolean {
  if (!tool.policyKey) return true
  const policy = (bot.globalConfig?.agentPolicy ?? {}) as AgentPolicy
  const v = (policy as Record<string, boolean | undefined>)[tool.policyKey]
  return v ?? POLICY_DEFAULTS[tool.policyKey] ?? true
}

// Traduz os knobs de tom em instruções de estilo. Defaults = humano de WhatsApp.
function toneLines(t: NonNullable<Bot['globalConfig']>['agentTone']): string[] {
  const formality = t?.formality ?? 'neutro'
  const emoji = t?.emoji ?? 'raro'
  const length = t?.length ?? 'curtas'
  const slang = t?.slang ?? false
  const out: string[] = []
  out.push(({
    informal: '- Escreva informal, como amigo trocando mensagem. Pode abreviar ("vc", "pra", "tá").',
    neutro:   '- Escreva natural e simples, nem formal nem forçado. Como uma pessoa normal teclando.',
    formal:   '- Escreva com cuidado e respeito, frases completas, sem abreviar.',
  })[formality])
  out.push(({
    nenhum:   '- Não use emojis.',
    raro:     '- Emoji só de vez em quando, no máximo um, quando couber de verdade.',
    moderado: '- Pode usar um ou dois emojis quando ajudar o clima.',
  })[emoji])
  out.push(length === 'curtas'
    ? '- Mensagens curtas, uma ideia por vez. Nada de textão.'
    : '- Mensagens de tamanho médio, mas sem enrolar.')
  if (slang) out.push('- Pode soltar uma gíria leve ou regionalismo, sem exagero.')
  return out
}

function buildSystemPrompt(bot: Bot, isFirstContact: boolean): string {
  const g = bot.globalConfig ?? {}
  const company = g.companyName ?? bot.name
  const greeting = isFirstContact && g.agentGreeting
    ? ['', '⚡ Esta é a PRIMEIRA mensagem dessa pessoa com você. Antes de responder qualquer outra coisa, ABRA se apresentando — com as SUAS palavras, no seu tom, sem soar template. Use esta orientação como guia (não copie literal):', g.agentGreeting]
    : []
  const base = [
    `Você está atendendo pelo WhatsApp da ${company}. Você é uma PESSOA de verdade atendendo — NÃO é um robô, um assistente virtual nem um bot, e nunca age como um.`,
    ...greeting,
    '',
    'Como você conversa:',
    ...toneLines(g.agentTone),
    '- No ritmo da pessoa: responde o que ela perguntou, sem despejar menu, lista de pacotes nem bloco pronto.',
    '- Fale como gente: nada de jargão de sistema ("carrinho", "pacote", "catálogo", "fluxo", "ferramenta"). A pessoa nunca deve perceber que existe um sistema por trás.',
    'Formatação (legibilidade no WhatsApp):',
    '- Separe ideias diferentes em parágrafos curtos, com UMA linha em branco entre eles. Nunca mande um bloco de texto corrido.',
    '- No máximo 2-3 linhas por parágrafo. Dê respiro pra facilitar a leitura.',
    '- Quando citar um nome de título ou um valor, pode destacar com *asteriscos* (negrito do WhatsApp), mas com moderação — só o essencial, nunca a mensagem toda.',
    '',
    'O que você faz (sem mostrar os bastidores):',
    '- Ajuda a pessoa a achar o que ela quer e fecha a venda de boa, no papo.',
    '- Você tem como buscar um título, cobrar no PIX e conferir o pagamento — faça isso por baixo dos panos, naturalmente, sem narrar o passo a passo.',
    '- Se a pessoa mandar um print ou foto (capa, título, cena, cartaz de uma série/filme), OLHE a imagem: identifique o nome do título e já busque pra ela. Não peça o nome se dá pra ver na imagem. Se a imagem estiver ruim ou em dúvida entre nomes, confirme o palpite ("é a *Tal*, né?") antes de buscar.',
    '- EXCEÇÃO: se a imagem for um comprovante de pagamento (recibo, print de PIX, transferência), NÃO trate como título — siga o fluxo de conferência de pagamento normalmente.',
    '',
    'AJA DE VERDADE — regra de ouro (a mais importante):',
    '- Quando for fazer uma ação (buscar título, gerar o PIX, conferir o comprovante, liberar o acesso), USE A FERRAMENTA AGORA, no mesmo turno. A ação só acontece se você chamar a ferramenta.',
    '- NUNCA diga que vai fazer e pare: "vou gerar o PIX", "só um instante", "já te mando", "deixa eu verificar" — se você apenas fala isso e não chama a ferramenta, NADA acontece e o cliente fica esperando pra sempre. Isso é a pior falha possível.',
    '- A pessoa confirmou a compra ("pode fechar", "fechou", "quero pagar")? Então CHAME generate_pix neste turno — não anuncie, faça. Recebeu comprovante com PIX pendente? CHAME validate_proof neste turno.',
    '- Pagamento confirmou (validate_proof aprovou)? CHAME deliver_access NO MESMO TURNO e mande os links. NUNCA diga só "pagamento confirmado" e pare — a pessoa pagou e está esperando o acesso. Confirmar sem entregar é deixar o cliente no prejuízo.',
    '- Aja primeiro; o texto vem junto com o resultado real da ferramenta, nunca como promessa de algo futuro.',
    '',
    'Como você conduz a conversa:',
    'Entendendo o cliente:',
    '- Número dentro do nome de um título/produto faz parte do NOME — não é quantidade nem versão. Só trate número como quantidade se vier separado ("quero 2"). Na dúvida, pergunte se o número faz parte do nome.',
    '- Entendeu o que a pessoa quer mas tem dúvida? Confirme afirmando: "acho que é *Tal*, é isso?" — nunca diga "não entendi" ou "repete". Vários itens numa mensagem? confirme todos antes de seguir.',
    '- Só busque um título quando a pessoa disser um NOME concreto. "não sei ainda", "tem catálogo?", "o que vocês têm?", "me mostra a lista" NÃO são nomes — NÃO busque no vazio. Nesses casos: mande o link do catálogo (está no seu conhecimento abaixo) ou pergunte o gênero/estilo que ela curte. Nunca responda "não encontrei nada" pra uma pessoa que ainda nem disse o que quer.',
    '- Espelhe o jeito do cliente a cada mensagem: curto→curto, formal→formal, solto com emoji→solto. NUNCA espelhe grosseria ou ironia; diante de raiva, mantenha a calma. Na dúvida do humor, tom neutro.',
    'Conduzindo pra venda:',
    '- Sinal de compra ("quanto", "tem tal?", "como pago", "quero") = vá direto: faça (buscar/cobrar), não fique só perguntando. Responda o sinal E abra o próximo passo ("quer que eu já gere o PIX?").',
    '- Com quem já quer, não empilhe argumentos: uma frase + ação.',
    '- Ofereça escolha em vez de sim/não ("só esse ou o pacote?"). Antes de cobrar, reafirme: "então é X por R$ Y, fechado — já te passo o PIX".',
    '- Recusou? Não insista no mesmo pedido: volte um passo (outra opção, pacote mais barato, tirar dúvida).',
    'Objeções:',
    '- Qualquer objeção: reconheça → responda curto e honesto → puxe de volta pra ação. Nunca discuta nem ignore.',
    '- "tá caro" → não dê desconto; ofereça opção mais barata do catálogo. "vou pensar" → pergunte leve o bloqueio (preço ou o produto).',
    '- Urgência só verdadeira: nunca invente prazo nem promoção; urgência leve só ligada à entrega ("assim que o PIX cair, já libero").',
    'Quando algo dá errado:',
    '- Cliente que PAGOU e foi acusado de comprovante inválido: NÃO defenda o sistema nem peça outro comprovante. Assuma a falha, peça desculpa uma vez e passe pra um humano. Ex.: "Poxa, me desculpa de verdade 🙏 o erro foi nosso, não seu. Já vou resolver e liberar agora."',
    '- Ferramenta falhou? Nunca mostre erro técnico: "só um segundo que eu confirmo aqui", tente de novo; persistindo, chame um humano.',
    '- Quando chamar um humano: pedido explícito, disputa de pagamento, cliente bravo após acusação, ou travou no mesmo ponto após 2 tentativas. Fora isso, siga você mesmo.',
    '- Use o que você sabe do cliente só quando for relevante — nunca liste tudo que sabe sobre ele.',
    '',
    'Limites (invisíveis pra pessoa, mas inegociáveis pra você):',
    '- Nunca invente título nem preço. Confira de verdade antes de falar qualquer valor.',
    '- Só dê um pagamento como confirmado quando o sistema confirmar — nunca por conta própria, nem "achando" pelo comprovante.',
    '- Só libere o acesso depois do pagamento confirmado.',
    '- Nunca afirme que algo NÃO existe (um link, um catálogo, um recurso) a menos que o seu conhecimento abaixo diga isso. Se você não sabe, não invente "não temos" — ofereça ajudar de outro jeito.',
    g.agentKnowledge ? `\nO que você sabe (use SOMENTE estes fatos como verdade; envie o link/dado quando fizer sentido; se algo não estiver aqui, não invente):\n${g.agentKnowledge}` : '',
    g.agentInstructions ? `\nOrientações do dono:\n${g.agentInstructions}` : '',
  ]
  return base.filter((l) => l !== undefined).join('\n')
}

// Erros que somem numa re-tentativa (Gemini timeout/5xx/429/rede) vs permanentes
// (auth/config/bug). Só os transitórios valem re-enfileirar — o resto vira handoff na hora.
function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  if (/auth failed|GOOGLE_SA|api key|unauthorized|\b401\b|\b403\b/i.test(msg)) return false
  return /timeout|abort|\b429\b|\b5\d\d\b|econn|enotfound|etimedout|socket|network|fetch failed|temporar/i.test(msg)
}

// "Promessa de ação" na saída do PRÓPRIO modelo (não input de cliente — a regra no-regex-input não se aplica).
// Usado pra detectar quando o agente anuncia que vai agir mas não chama ferramenta → auto-nudge.
function isActionPromise(text: string): boolean {
  const t = (text ?? '').toLowerCase()
  return /s[óo]\s+um\s+(instante|momento|segundo|minutinho|minuto)|um\s+momento|j[áa]\s+(te|j[áa])\b|deixa\s+eu|vou\s+(buscar|adicionar|gerar|verificar|conferir|ver|pegar|colocar|providenciar|checar|procurar)|estou\s+(buscando|verificando|adicionando|gerando|procurando)|\b(buscando|adicionando|gerando|verificando|procurando)\b|aguarda|aguarde|pera[íi]|j[áa]\s+volto/.test(t)
}

export class AgentRuntime {
  constructor(
    private provider: IAgentProvider,
    private convRepo: ConversationRepository,
    private leadRepo: LeadRepository,
    private messaging: MessagingPort,
    private services: ToolServices,
    private moduleRegistry: ModuleRegistry,
    private trace?: AgentTraceRepository,   // auditoria durável (opcional, non-blocking)
  ) {}

  async handleIncomingMessage(bot: Bot, phoneNumber: string, message: string, imageBase64?: string, opts?: { isLastAttempt?: boolean }): Promise<void> {
    // default true = se ninguém informar a tentativa, comporta como antes (handoff, não re-tenta)
    const isLastAttempt = opts?.isLastAttempt ?? true
    let conversation = await this.convRepo.findActiveByPhone(bot.id, phoneNumber)
    if (!conversation || conversation.status === 'ended') {
      conversation = Conversation.create({ botId: bot.id, flowId: bot.activeFlowId ?? '__agent__', phoneNumber, triggerNodeId: '__agent__' })
    }
    const lead = await this.leadRepo.findByPhone(bot.id, phoneNumber)
    // 1º contato = ainda não houve nenhuma resposta nossa nesta conversa
    const isFirstContact = !conversation.history.some(m => m.role === 'assistant')
    conversation.addUserMessage(message, { sender: phoneNumber })
    if (imageBase64) conversation.setVariable('__imageBase64', imageBase64)

    // Abertura VERBATIM (determinística): no 1º contato, envia a intro literal e encerra o turno.
    // Garante copy/preços exatos sem passar pela IA. A IA assume natural a partir da próxima mensagem.
    const intro = bot.globalConfig?.agentIntroMessage
    if (isFirstContact && intro && intro.trim()) {
      console.log(`[agent] intro verbatim phone=${phoneNumber} (1º contato)`)
      await this.messaging.sendMessage({
        instanceName: bot.evolutionConfig.instanceName,
        instanceId: bot.evolutionConfig.instanceId ?? '',
        phoneNumber,
        message: intro,
      })
      conversation.addAssistantMessage(intro)
      await this.convRepo.save(conversation)
      return
    }

    const ctx: ToolContext = { bot, conversation, lead, imageBase64, services: this.services }
    // Tool-set vem do Registro de Módulos: a tool entra só se o MÓDULO dela está ligado (F2) E a política permite.
    // Tudo defaultEnabled=true → idêntico a hoje; desligar um módulo remove suas tools do agente.
    const enabledToolNames = new Set(this.moduleRegistry.toolsForBot(bot))
    const tools = AGENT_TOOLS.filter(t => enabledToolNames.has(t.name) && toolAllowed(bot, t))
    const toolDefs: ToolDef[] = tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    const byName = new Map(tools.map(t => [t.name, t]))

    // working messages = histórico (texto) + turnos de tool deste turno
    const working: AgentMessage[] = conversation.history.slice(-HISTORY_LIMIT).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user', text: m.content,
    }))
    // Visão: anexa a imagem recebida AGORA à última mensagem do usuário (Gemini é multimodal).
    if (imageBase64) {
      for (let i = working.length - 1; i >= 0; i--) {
        if (working[i].role === 'user') {
          ;(working[i] as Extract<AgentMessage, { role: 'user' }>).images = [{ mimeType: 'image/jpeg', dataBase64: imageBase64 }]
          break
        }
      }
    }

    const system = buildSystemPrompt(bot, isFirstContact)
    const callCounts = new Map<string, number>()
    let finalText = ''
    let lastStop = ''
    let lastStep = 0
    let anyToolThisTurn = false
    let nudged = false
    // Trilha durável (auditoria): quem foi chamado, como, o que voltou. Fire-and-forget.
    const rec = (p: {
      step: number; kind: 'tool' | 'reply' | 'error' | 'nudge'; toolName?: string; toolInput?: Record<string, unknown>
      resultCode?: string; resultSuccess?: boolean; text?: string; stopReason?: string; latencyMs?: number
    }) => {
      void this.trace?.save({ botId: bot.id, conversationId: conversation.id, phoneNumber, turnMessage: message, provider: this.provider.name, ...p })
    }

    console.log(`[agent] start phone=${phoneNumber} bot=${bot.evolutionConfig.instanceName} msg="${message.slice(0, 60)}" hasImage=${!!imageBase64}`)
    try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const t0 = Date.now()
      const resp = await this.provider.complete({ system, messages: working, tools: toolDefs, maxTokens: 1024 })
      console.log(`[agent] step=${step} stop=${resp.stopReason} ms=${Date.now() - t0} tools=${(resp.toolCalls ?? []).map(c => c.name).join(',') || '-'} text="${(resp.text ?? '').slice(0, 60)}"`)
      lastStop = resp.stopReason; lastStep = step

      if (resp.stopReason !== 'tool_use') {
        finalText = resp.text ?? ''
        // Promete-e-para: o modelo anunciou a ação mas não chamou ferramenta NENHUMA neste turno
        // → nada acontece e o cliente trava. Cutuca UMA vez pra executar agora.
        if (!anyToolThisTurn && !nudged && isActionPromise(finalText)) {
          nudged = true
          console.warn('[agent] promete-e-para detectado → auto-nudge p/ executar')
          rec({ step, kind: 'nudge', text: finalText, stopReason: 'promise_no_action' })
          working.push({ role: 'assistant', text: resp.text })
          working.push({ role: 'user', text: '[sistema] Você disse que ia agir mas NÃO chamou nenhuma ferramenta — então nada aconteceu de verdade. Execute AGORA, neste turno, chamando a ferramenta necessária (ex: search_catalog → add_to_cart → generate_pix). Não responda só texto.' })
          finalText = ''
          continue
        }
        break
      }

      working.push({ role: 'assistant', text: resp.text, toolCalls: resp.toolCalls })
      const results: ToolResultMsg[] = []
      let stalled = false

      for (const call of resp.toolCalls) {
        // detecção de loop: mesma tool+input repetida → encerra
        const sig = `${call.name}:${JSON.stringify(call.input)}`
        const n = (callCounts.get(sig) ?? 0) + 1
        callCounts.set(sig, n)
        if (n >= 3) { stalled = true; break }

        const tool = byName.get(call.name)
        let out
        if (!tool) out = { success: false, code: 'UNKNOWN_TOOL', message: `tool ${call.name} não existe` }
        else {
          try { out = await tool.execute(call.input, ctx) }
          catch (e) { out = { success: false, code: 'TOOL_ERROR', message: e instanceof Error ? e.message : String(e) } }
        }
        console.log(`[agent] tool=${call.name} → ${out.code} (success=${out.success})`)
        results.push({ toolCallId: call.id, name: call.name, output: out })
        rec({ step, kind: 'tool', toolName: call.name, toolInput: call.input as Record<string, unknown>, resultCode: out.code, resultSuccess: out.success, latencyMs: Date.now() - t0 })
        anyToolThisTurn = true
      }

      if (stalled) {
        console.warn('[agent] loop detectado sem avanço → handoff')
        conversation.handoff()
        finalText = 'Vou te conectar com nossa equipe para te ajudar melhor 😊'
        break
      }
      working.push({ role: 'tool', results })
    }

    if (!finalText) {
      conversation.handoff()
      finalText = 'Deixa eu chamar alguém da equipe pra te ajudar 😊'
    }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      // Transitório e ainda há tentativa? Re-lança SEM responder: o BullMQ re-processa
      // sozinho em segundos — o cliente não precisa mandar mensagem pra "acordar".
      // Idempotência (generate_pix reusa intent pendente) garante re-processar sem duplicar.
      if (isTransientError(e) && !isLastAttempt) {
        console.warn(`[agent] erro transitório phone=${phoneNumber} → re-enfileira: ${errMsg}`)
        throw e
      }
      // Permanente, ou esgotou as tentativas → não deixa o cliente no vácuo.
      console.error(`[agent] ERRO phone=${phoneNumber}:`, errMsg)
      conversation.handoff()
      finalText = 'Tive um probleminha aqui 😅 já chamei alguém da equipe pra te ajudar.'
      rec({ step: lastStep, kind: 'error', text: errMsg, stopReason: 'error' })
    }

    // Rede de segurança da ENTREGA: pagamento confirmado mas os links não saíram?
    // A pessoa PAGOU — a entrega não pode depender do modelo lembrar de chamar deliver_access.
    if (conversation.phase === 'payment_confirmed' && this.moduleRegistry.isEnabled(bot, MODULE_IDS.DELIVERY)) {
      const links = Cart.fromVariables(conversation.variables).accessLinks
      if (links) {
        finalText = `${finalText}\n\n🎬 Aqui está seu acesso:\n${links}`.trim()
        conversation.setPhase('post_purchase')
        console.log(`[agent] entrega forçada (rede de segurança) phone=${phoneNumber}`)
      }
    }

    rec({ step: lastStep, kind: 'reply', text: finalText, stopReason: lastStop })
    console.log(`[agent] reply phone=${phoneNumber} text="${finalText.slice(0, 80)}"`)
    await this.messaging.sendMessage({
      instanceName: bot.evolutionConfig.instanceName,
      instanceId: bot.evolutionConfig.instanceId ?? '',
      phoneNumber,
      message: finalText,
    })
    conversation.addAssistantMessage(finalText)
    await this.convRepo.save(conversation)
  }
}
