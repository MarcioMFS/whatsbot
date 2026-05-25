import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { X, Settings, ChevronDown, Check } from 'lucide-react'

interface IntentRule {
  handle: string; label?: string; patterns?: string[]; keywords?: string[]
  extractNumber?: boolean; isDefault?: boolean
}
interface IntentAiAgent {
  enabled: boolean; provider?: string; systemPrompt: string
  canRespondInline?: boolean; availableHandles?: Array<{ handle: string; description: string }>
}
interface CaptureInterceptorData {
  enabled: boolean; provider?: string; systemPrompt: string
  contextVariables?: string[]; redirectHandles?: Array<{ handle: string; description: string }>
}

interface FlowNode {
  id: string
  type?: string
  data: Record<string, unknown>
}

interface Props {
  node: { id: string; type: string; data: Record<string, unknown> }
  onUpdate: (id: string, data: Record<string, unknown>) => void
  onClose: () => void
  nodes: FlowNode[]
}

export function NodeConfigPanel({ node, onUpdate, onClose, nodes }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [varsOpen, setVarsOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!panelRef.current) return
    gsap.fromTo(panelRef.current, { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power3.out' })
  }, [node.id])

  useEffect(() => {
    setVarsOpen(false)
  }, [node.id])

  const set = (key: string, value: unknown) => onUpdate(node.id, { [key]: value })

  const systemVars = ['phone', 'message', 'name']
  const capturedVars = nodes
    .filter(n => n.type === 'capture' && n.data.variableName)
    .map(n => String(n.data.variableName))
  const aiVars = nodes
    .filter(n => n.type === 'ai_response' && n.data.saveResponseAs)
    .map(n => String(n.data.saveResponseAs))

  const allVars = [...new Set([...systemVars, ...capturedVars, ...aiVars])]
  const conditionVars = [...new Set([...capturedVars, ...aiVars])]

  const copyVar = (name: string) => {
    const text = `{{${name}}}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(name)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div ref={panelRef} className="w-72 border-l border-glass-border glass overflow-y-auto" style={{ borderRadius: 0 }}>
      <div className="flex items-center justify-between p-4 border-b border-glass-border">
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-brand-400" />
          <span className="text-sm font-semibold text-white capitalize">{node.type.replace('_', ' ')}</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors"><X size={16} /></button>
      </div>

      <div className="px-4 pt-3 relative">
        <button
          onClick={() => setVarsOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-glass-100 border border-glass-border text-xs font-medium text-slate-300 hover:text-white hover:border-brand-500/40 transition-all"
        >
          <span>Variáveis disponíveis</span>
          <ChevronDown size={13} className={`transition-transform duration-200 ${varsOpen ? 'rotate-180' : ''}`} />
        </button>

        {varsOpen && (
          <div className="absolute left-4 right-4 top-[calc(100%-4px)] z-50 glass border border-glass-border rounded-xl p-3 shadow-xl">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Click to copy</p>
            <div className="flex flex-wrap gap-1.5">
              {allVars.map(name => (
                <button
                  key={name}
                  onClick={() => copyVar(name)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-mono hover:bg-brand-500/20 transition-all"
                >
                  {copied === name ? <><Check size={10} className="text-emerald-400" /><span className="text-emerald-400">Copiado!</span></> : `{{${name}}}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {node.type !== 'capture' && (
          <Field label="Label" value={String(node.data.label ?? '')} onChange={v => set('label', v)} />
        )}

        {node.type === 'text_message' && (
          <Field label="Message" value={String(node.data.message ?? '')} onChange={v => set('message', v)} textarea
            hint="Use {{variable_name}} to insert captured values." />
        )}

        {node.type === 'ai_response' && (
          <>
            <Field label="Prompt / Treinamento" value={String(node.data.promptTemplate ?? '')} onChange={v => set('promptTemplate', v)} textarea
              hint="Use {{phone}}, {{message}}, ou variáveis capturadas." />
            <Field label="Salvar resposta como variável (opcional)" value={String(node.data.saveResponseAs ?? '')} onChange={v => set('saveResponseAs', v)}
              placeholder="ex: ai_response" hint="Se preenchido, não envia ao usuário — use em Condição." />
            <Toggle label="Manter histórico da conversa" checked={Boolean(node.data.useHistory)} onChange={v => set('useHistory', v)} />
            <p className="text-xs text-slate-500">Saída <span className="text-emerald-400">verde</span> = sucesso · <span className="text-red-400">vermelha</span> = erro de API</p>
          </>
        )}

        {node.type === 'condition' && (
          <>
            {conditionVars.length > 0 ? (
              <Select
                label="Variável"
                value={String(node.data.variable ?? '')}
                onChange={v => set('variable', v)}
                options={conditionVars.map(v => ({ value: v, label: `{{${v}}}` }))}
              />
            ) : (
              <Field label="Variável" value={String(node.data.variable ?? '')} onChange={v => set('variable', v)}
                placeholder="Adicione um nó Capture primeiro" />
            )}
            <Select label="Operador" value={String(node.data.operator ?? 'contains')} onChange={v => set('operator', v)}
              options={[
                { value: 'contains', label: 'Contém' },
                { value: 'equals', label: 'Igual a' },
                { value: 'starts_with', label: 'Começa com' },
                { value: 'regex', label: 'Regex' },
              ]} />
            <Field label="Valor" value={String(node.data.value ?? '')} onChange={v => set('value', v)}
              placeholder="ex: #positivo" />
            <p className="text-xs text-slate-500">Conecte <span className="text-emerald-400">verde (true)</span> e <span className="text-red-400">vermelho (false)</span> a caminhos diferentes.</p>
          </>
        )}

        {node.type === 'capture' && (
          <>
            <Field label="Pergunta / Prompt" value={String(node.data.label ?? '')} onChange={v => set('label', v)} textarea />
            <Field label="Salvar resposta como variável" value={String(node.data.variableName ?? '')} onChange={v => set('variableName', v)} placeholder="ex: nome_usuario" />
            <Select label="Tipo de entrada esperado" value={String(node.data.expectedInputType ?? 'any')} onChange={v => set('expectedInputType', v)}
              options={[
                { value: 'any', label: 'Qualquer' },
                { value: 'text', label: 'Texto' },
                { value: 'image', label: 'Imagem' },
                { value: 'document', label: 'Documento' },
                { value: 'audio', label: 'Áudio' },
              ]} />
            <Field label="Regex de validação (opcional)" value={String(node.data.validationRegex ?? '')} onChange={v => set('validationRegex', v)} placeholder="^\d+$" />
            <Field label="Mensagem de erro" value={String(node.data.errorMessage ?? '')} onChange={v => set('errorMessage', v)} placeholder="Resposta inválida, tente novamente." />
            <div className="border-t border-white/5 pt-3 mt-1">
              <p className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1">⏱ Timeout (sem resposta)</p>
              <NumberField label="Tempo limite (minutos, 0 = desativado)" value={Number(node.data.timeoutMinutes ?? 0)} onChange={v => set('timeoutMinutes', v)} min={0} max={1440} />
              {Number(node.data.timeoutMinutes ?? 0) > 0 && (
                <>
                  <Field label="Mensagem ao expirar (opcional)" value={String(node.data.timeoutMessage ?? '')} onChange={v => set('timeoutMessage', v)} placeholder="Ainda está aí? 👋" />
                  <Select label="Comportamento ao expirar" value={String(node.data.timeoutBehavior ?? 'suspend')} onChange={v => set('timeoutBehavior', v)}
                    options={[
                      { value: 'suspend', label: 'Suspender (recuperável)' },
                      { value: 'followup', label: 'Seguir pelo handle timeout' },
                      { value: 'end', label: 'Encerrar conversa' },
                    ]} />
                  <p className="text-xs text-slate-500 mt-1">Conecte o handle <span className="text-amber-400">âmbar</span> ao caminho de "sem resposta".</p>
                </>
              )}
            </div>
            <div className="border-t border-white/5 pt-3 mt-1">
              <p className="text-xs font-semibold text-brand-400 mb-2">🔁 Recovery (suspensão inteligente)</p>
              <Field label="Motivo da suspensão (analytics)" value={String(node.data.suspendedReason ?? '')} onChange={v => set('suspendedReason', v)}
                placeholder="awaiting_pix_receipt"
                hint="Identificador para analytics e recuperação automática." />
              <Field label="Hints de recuperação (vírgula)" value={String((node.data.recoveryHints as string[] ?? []).join(', '))}
                onChange={v => set('recoveryHints', v.split(',').map((h: string) => h.trim()).filter(Boolean))}
                placeholder="comprovante, enviei, pix, foto"
                hint="Palavras-chave que disparam recuperação automática da conversa suspensa." />
            </div>
            <div className="border-t border-white/5 pt-3 mt-1">
              <p className="text-xs font-semibold text-violet-400 mb-2">🤖 Interceptor (off-topic)</p>
              <p className="text-xs text-slate-500 mb-2">IA responde perguntas enquanto o bot aguarda a entrada esperada. O waiting state é preservado.</p>
              <Toggle label="Ativar interceptor"
                checked={Boolean((node.data.interceptor as CaptureInterceptorData | undefined)?.enabled)}
                onChange={v => set('interceptor', { ...((node.data.interceptor as CaptureInterceptorData) ?? { systemPrompt: '' }), enabled: v })} />
              {(node.data.interceptor as CaptureInterceptorData | undefined)?.enabled && (
                <>
                  <Select label="Provider" value={String((node.data.interceptor as CaptureInterceptorData).provider ?? 'groq')}
                    onChange={v => set('interceptor', { ...(node.data.interceptor as CaptureInterceptorData), provider: v })}
                    options={[{ value: 'groq', label: 'Groq (rápido)' }, { value: 'claude', label: 'Claude (preciso)' }]} />
                  <Field label="System Prompt" value={String((node.data.interceptor as CaptureInterceptorData).systemPrompt ?? '')}
                    onChange={v => set('interceptor', { ...(node.data.interceptor as CaptureInterceptorData), systemPrompt: v })}
                    textarea placeholder="Você é assistente DramaHub. O bot aguarda um comprovante de pagamento Pix." />
                  <Field label="Variáveis de contexto (vírgula)"
                    value={String(((node.data.interceptor as CaptureInterceptorData).contextVariables ?? []).join(', '))}
                    onChange={v => set('interceptor', { ...(node.data.interceptor as CaptureInterceptorData), contextVariables: v.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="__rt_checkout_final_total_brl, __rt_cart_count"
                    hint="Variáveis injetadas no contexto da IA para ela responder com dados reais." />
                  <div className="mt-3">
                    <p className="text-xs font-medium text-slate-300 mb-1.5">Handles de redirecionamento (opcional)</p>
                    <AvailableHandlesList
                      handles={((node.data.interceptor as CaptureInterceptorData).redirectHandles ?? [])}
                      onChange={handles => set('interceptor', { ...(node.data.interceptor as CaptureInterceptorData), redirectHandles: handles })}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">IA decide: <span className="font-mono text-violet-300">answer</span> (responde, fica em waiting) · <span className="font-mono text-violet-300">redirect</span> (segue handle) · <span className="font-mono text-violet-300">ignore</span> (rejeição normal)</p>
                </>
              )}
            </div>
          </>
        )}

        {node.type === 'distributor' && (
          <VariationsList
            variations={(node.data.variations as string[] | undefined) ?? []}
            onChange={v => set('variations', v)}
          />
        )}

        {node.type === 'notification' && (
          <>
            <Field label="Número do destinatário" value={String(node.data.phoneNumber ?? '')} onChange={v => set('phoneNumber', v)}
              placeholder="5511999999999" hint="Número do dono do bot. Use {{phone}} para enviar ao lead." />
            <Field label="Mensagem" value={String(node.data.message ?? '')} onChange={v => set('message', v)} textarea
              hint="Use {{phone}}, {{name}}, {{message}} e variáveis capturadas." />
          </>
        )}

        {node.type === 'pixel' && (
          <>
            <Field label="Pixel ID" value={String(node.data.pixelId ?? '')} onChange={v => set('pixelId', v)} placeholder="123456789" />
            <Field label="Access Token" value={String(node.data.accessToken ?? '')} onChange={v => set('accessToken', v)} placeholder="EAAxxxx..." />
            <Select label="Evento" value={String(node.data.eventName ?? 'Purchase')} onChange={v => set('eventName', v)}
              options={[
                { value: 'Purchase', label: 'Purchase (Compra)' },
                { value: 'Lead', label: 'Lead' },
                { value: 'InitiateCheckout', label: 'Initiate Checkout' },
                { value: 'ViewContent', label: 'View Content' },
              ]} />
            <Field label="Valor (R$)" value={String(node.data.value ?? '0')} onChange={v => set('value', v)}
              placeholder="15.00 ou {{valor}}" hint="Suporta variáveis capturadas." />
            <Select label="Moeda" value={String(node.data.currency ?? 'BRL')} onChange={v => set('currency', v)}
              options={[{ value: 'BRL', label: 'BRL' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }]} />
          </>
        )}

        {node.type === 'pix' && (
          <>
            <Field label="Chave Pix" value={String(node.data.pixKey ?? '')} onChange={v => set('pixKey', v)}
              placeholder="email@exemplo.com / CPF / CNPJ / aleatória" />
            <Field label="Nome do favorecido" value={String(node.data.recipientName ?? '')} onChange={v => set('recipientName', v)} placeholder="João Silva" />
            <Field label="Valor (R$)" value={String(node.data.amount ?? '')} onChange={v => set('amount', v)}
              placeholder="15,00 ou R$ 15,00 ou 1500 centavos"
              hint="Formatos: '15,00', 'R$ 15,00', '1500' (centavos). Suporta {{variavel}}." />
            <Field label="Descrição" value={String(node.data.description ?? '')} onChange={v => set('description', v)} placeholder="Plano de receitas fit" />
            <div className="border-t border-white/5 pt-3 mt-1">
              <p className="text-xs font-semibold text-emerald-400 mb-2">💳 PaymentIntent (antifraude)</p>
              <NumberField label="Expirar em (minutos, 0 = 60min padrão)" value={Number(node.data.expiresInMinutes ?? 0)} onChange={v => set('expiresInMinutes', v || undefined)} min={0} max={1440} />
              <Field label="Salvar ID do pagamento como variável" value={String(node.data.outputVariable ?? '')} onChange={v => set('outputVariable', v || undefined)}
                placeholder="paymentIntentId"
                hint="Variável usada pelo nó 'Validar Comprovante' para verificar o pagamento." />
              <p className="text-xs text-slate-500 mt-1">Requer chave Pix + valor para criar o PaymentIntent automaticamente.</p>
            </div>
          </>
        )}

        {node.type === 'label' && (
          <Field label="Nome da etiqueta" value={String(node.data.labelName ?? '')} onChange={v => set('labelName', v)}
            placeholder="lead-quente" hint="Etiqueta importada do WhatsApp Business para marcar o contato." />
        )}

        {node.type === 'tag_lead' && (
          <>
            <Field label="Adicionar tags (vírgula)" value={String((node.data.add as string[] ?? []).join(', '))}
              onChange={v => set('add', v.split(',').map(t => t.trim()).filter(Boolean))}
              placeholder="quente, interessado"
              hint="Tags adicionadas ao perfil permanente do lead." />
            <Field label="Remover tags (vírgula)" value={String((node.data.remove as string[] ?? []).join(', '))}
              onChange={v => set('remove', v.split(',').map(t => t.trim()).filter(Boolean))}
              placeholder="frio, lead-negativo" />
          </>
        )}

        {node.type === 'webhook' && (
          <>
            <Field label="URL" value={String(node.data.url ?? '')} onChange={v => set('url', v)} placeholder="https://..." />
            <Select label="Method" value={String(node.data.method ?? 'POST')} onChange={v => set('method', v)}
              options={['GET', 'POST', 'PUT'].map(v => ({ value: v, label: v }))} />
            <Field label="Body Template (JSON)" value={String(node.data.bodyTemplate ?? '')} onChange={v => set('bodyTemplate', v)} textarea
              hint='Use {{variable}} in body. e.g. {"name": "{{user_name}}"}' />
            <Field label="Save response as" value={String(node.data.saveResponseAs ?? '')} onChange={v => set('saveResponseAs', v)} placeholder="webhook_response" />
          </>
        )}

        {node.type === 'trigger' && (
          <>
            <Select label="Trigger Type" value={String(node.data.triggerType ?? 'any_message')} onChange={v => set('triggerType', v)}
              options={[
                { value: 'any_message', label: 'Any Message' },
                { value: 'first_message', label: 'First Message' },
                { value: 'keyword', label: 'Keyword Match' },
              ]} />
            {node.data.triggerType === 'keyword' && (
              <Field label="Keywords (comma-separated)" value={String((node.data.keywords as string[] ?? []).join(', '))}
                onChange={v => set('keywords', v.split(',').map(k => k.trim()).filter(Boolean))} placeholder="hi, hello, start" />
            )}
          </>
        )}

        {node.type === 'ai_validate_receipt' && (
          <>
            <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 mb-2">
              <p className="text-xs text-emerald-400 font-semibold mb-1">Validar Comprovante Pix</p>
              <p className="text-xs text-slate-400">Extrai dados da imagem com IA e valida contra o PaymentIntent criado pelo nó Pix (11 regras antifraude).</p>
            </div>
            <Field
              label="Variável com paymentIntentId"
              value={String(node.data.paymentIntentVariable ?? 'paymentIntentId')}
              onChange={v => set('paymentIntentVariable', v)}
              placeholder="paymentIntentId"
              hint="Deve ser a mesma variável configurada no nó Pix → 'Salvar ID como variável'."
            />
            <div className="space-y-1 mt-2">
              <p className="text-xs font-medium text-slate-300">Saídas:</p>
              <p className="text-xs text-slate-500"><span className="text-emerald-400 font-mono">approved</span> — pagamento válido → confirmar compra</p>
              <p className="text-xs text-slate-500"><span className="text-red-400 font-mono">rejected</span> — inválido / suspeito → pedir novo comprovante</p>
            </div>
            <p className="text-xs text-slate-500 mt-1">Variáveis geradas: <span className="font-mono text-slate-400">__validation_reason</span>, <span className="font-mono text-slate-400">__validation_approved</span></p>
          </>
        )}

        {node.type === 'payment_confirmed' && (
          <>
            <div className="p-3 rounded-xl bg-brand-500/5 border border-brand-500/20 mb-2">
              <p className="text-xs text-brand-400 font-semibold mb-1">Confirmação de Pagamento</p>
              <p className="text-xs text-slate-400">Marca o lead como comprador, seta fase post_purchase_support e envia as mensagens de confirmação.</p>
            </div>
            <Field label="Mensagem de confirmação" value={String(node.data.confirmationMessage ?? '')} onChange={v => set('confirmationMessage', v)} textarea
              placeholder="✅ Pagamento confirmado! Obrigado pela sua compra, {{name}}!"
              hint="Enviada imediatamente após aprovação. Suporta {{phone}}, {{name}}, variáveis." />
            <Field label="Mensagem de entrega / pós-compra" value={String(node.data.postPurchaseMessage ?? '')} onChange={v => set('postPurchaseMessage', v)} textarea
              placeholder="🎉 Aqui está seu material: [link]. Em que posso te ajudar?"
              hint="Enviada logo após a confirmação. Coloque o link do produto aqui." />
          </>
        )}

        {node.type === 'catalog_search' && (
          <>
            <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 mb-2">
              <p className="text-xs text-indigo-400 font-semibold mb-1">Busca no Catálogo</p>
              <p className="text-xs text-slate-400">Busca produtos por nome, aliases e fuzzy match. IA entra apenas como fallback para mensagens ambíguas.</p>
            </div>
            <Field label="Buscar a partir de (variável)" value={String(node.data.searchFrom ?? '')} onChange={v => set('searchFrom', v)}
              placeholder="deixe vazio para usar a mensagem atual"
              hint="Nome de variável que contém o texto de busca. Ex: series_pedidas" />
            <p className="text-xs text-slate-500 mt-1">Saídas: <span className="text-emerald-400 font-mono">found</span> (≥1 produto) · <span className="text-red-400 font-mono">not_found</span></p>
            <p className="text-xs text-slate-500 mt-1">Variáveis: <span className="font-mono text-slate-400">__rt_catalog_found</span> (JSON), <span className="font-mono text-slate-400">__rt_search_query</span>, <span className="font-mono text-slate-400">__rt_has_unresolved</span></p>
          </>
        )}

        {node.type === 'cart_add' && (
          <>
            <div className="p-3 rounded-xl bg-lime-500/5 border border-lime-500/20 mb-2">
              <p className="text-xs text-lime-400 font-semibold mb-1">Adicionar ao Carrinho</p>
              <p className="text-xs text-slate-400">Lê <span className="font-mono">__rt_catalog_found</span> e adiciona todos os produtos ao carrinho. Guardrail: máx 20 itens / 10 KB.</p>
            </div>
            <p className="text-xs text-slate-500">Saídas: <span className="text-emerald-400 font-mono">success</span> · <span className="text-red-400 font-mono">error</span> (guardrail)</p>
            <p className="text-xs text-slate-500 mt-1">Variáveis atualizadas: <span className="font-mono text-slate-400">__rt_cart</span>, <span className="font-mono text-slate-400">__rt_cart_total</span>, <span className="font-mono text-slate-400">__rt_cart_count</span>, <span className="font-mono text-slate-400">__rt_cart_summary</span></p>
          </>
        )}

        {node.type === 'cart_summary' && (
          <>
            <Field label="Template da mensagem" value={String(node.data.messageTemplate ?? '')} onChange={v => set('messageTemplate', v)} textarea
              placeholder="🛒 Seu carrinho:\n\n{{__rt_cart_summary}}\n\nTotal: {{__rt_cart_total}} centavos"
              hint="Variáveis: {{__rt_cart_summary}}, {{__rt_cart_count}}, {{__rt_cart_total}}" />
          </>
        )}

        {node.type === 'checkout' && (
          <>
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 mb-2">
              <p className="text-xs text-amber-400 font-semibold mb-1">Checkout com Pix</p>
              <p className="text-xs text-slate-400">Cria PaymentIntent com total do carrinho e envia mensagem Pix ao cliente. Substitui o nó Pix em fluxos de carrinho.</p>
            </div>
            <Field label="Chave Pix" value={String(node.data.receiverKey ?? '')} onChange={v => set('receiverKey', v)}
              placeholder="deixe vazio para usar config global do bot"
              hint="Fallback: bot.globalConfig.defaultPixKey" />
            <Field label="Favorecido" value={String(node.data.receiverName ?? '')} onChange={v => set('receiverName', v)}
              placeholder="Nome do favorecido"
              hint="Fallback: bot.globalConfig.defaultReceiverName" />
            <NumberField label="Expiração (minutos)" value={Number(node.data.expiresInMinutes ?? 60)} onChange={v => set('expiresInMinutes', v)} min={5} max={1440} />
            <Field label="Variável de saída" value={String(node.data.outputVariable ?? '')} onChange={v => set('outputVariable', v)}
              placeholder="__rt_checkout_payment_id"
              hint="Onde salvar o paymentIntentId" />
            <p className="text-xs text-slate-500 mt-1">Saídas: <span className="text-emerald-400 font-mono">success</span> (Pix enviado) · <span className="text-red-400 font-mono">error</span></p>
          </>
        )}

        {node.type === 'package_pix' && (
          <>
            <div className="p-3 rounded-xl bg-orange-400/5 border border-orange-400/20 mb-2">
              <p className="text-xs text-orange-300 font-semibold mb-1">Package Pix — por quantidade</p>
              <p className="text-xs text-slate-400">Lê uma variável com a quantidade pedida pelo cliente, aplica o PackageOffer correspondente e gera o Pix com o valor correto. Reutiliza PricingService + PaymentIntentRepository.</p>
            </div>
            <Field label="Variável da quantidade *" value={String(node.data.quantityVariable ?? '')} onChange={v => set('quantityVariable', v)}
              placeholder="ex: qty_pedida"
              hint='Aceita "2", "quero 3", "só uma" etc.' />
            <NumberField label="Preço unitário (centavos)" value={Number(node.data.unitPriceCentavos ?? 600)} onChange={v => set('unitPriceCentavos', v)} min={1} max={99999}
              hint="Padrão: 600 (R$ 6,00 por série)" />
            <Field label="Chave Pix" value={String(node.data.pixKey ?? '')} onChange={v => set('pixKey', v)}
              placeholder="deixe vazio para usar config global do bot" />
            <Field label="Favorecido" value={String(node.data.recipientName ?? '')} onChange={v => set('recipientName', v)}
              placeholder="deixe vazio para usar config global" />
            <NumberField label="Expiração (minutos)" value={Number(node.data.expiresInMinutes ?? 60)} onChange={v => set('expiresInMinutes', v)} min={5} max={1440} />
            <Field label="Variável de saída" value={String(node.data.outputVariable ?? '')} onChange={v => set('outputVariable', v)}
              placeholder="paymentIntentId"
              hint="Onde salvar o paymentIntentId" />
            <p className="text-xs text-slate-500 mt-1">Runtime vars: <span className="text-orange-300 font-mono">__rt_package_quantity</span>, <span className="text-orange-300 font-mono">__rt_checkout_*</span></p>
            <p className="text-xs text-slate-500 mt-0.5">Saídas: <span className="text-emerald-400 font-mono">success</span> · <span className="text-red-400 font-mono">error</span> (qty inválida)</p>
          </>
        )}

        {node.type === 'classify_intent' && (
          <>
            <div className="p-3 rounded-xl bg-cyan-400/5 border border-cyan-400/20 mb-2">
              <p className="text-xs text-cyan-300 font-semibold mb-1">Classify Intent — Híbrido</p>
              <p className="text-xs text-slate-400">Regras determinísticas primeiro. IA entra como fallback quando nenhuma regra bate.</p>
            </div>
            <Field label="Variável com o texto (opcional)" value={String(node.data.messageVariable ?? '')} onChange={v => set('messageVariable', v)}
              placeholder="deixe vazio = última mensagem do cliente"
              hint="Ex: user_initial_message" />

            <div className="border-t border-white/5 pt-3 mt-1">
              <p className="text-xs font-semibold text-cyan-400 mb-2">📋 Regras (executadas em ordem)</p>
              <IntentRuleList
                rules={(node.data.intents as IntentRule[] | undefined) ?? []}
                onChange={rules => set('intents', rules)}
              />
            </div>

            <div className="border-t border-white/5 pt-3 mt-1">
              <p className="text-xs font-semibold text-purple-400 mb-2">🤖 AI Agent (fallback)</p>
              <Toggle label="Ativar AI Agent"
                checked={Boolean((node.data.aiAgent as IntentAiAgent | undefined)?.enabled)}
                onChange={v => set('aiAgent', { ...((node.data.aiAgent as IntentAiAgent) ?? { systemPrompt: '' }), enabled: v })} />
              {(node.data.aiAgent as IntentAiAgent | undefined)?.enabled && (
                <>
                  <Select label="Provider" value={String((node.data.aiAgent as IntentAiAgent).provider ?? 'groq')}
                    onChange={v => set('aiAgent', { ...(node.data.aiAgent as IntentAiAgent), provider: v })}
                    options={[{ value: 'groq', label: 'Groq (rápido)' }, { value: 'claude', label: 'Claude (preciso)' }]} />
                  <Field label="System Prompt" value={String((node.data.aiAgent as IntentAiAgent).systemPrompt ?? '')}
                    onChange={v => set('aiAgent', { ...(node.data.aiAgent as IntentAiAgent), systemPrompt: v })}
                    textarea placeholder="Você é assistente do DramaHub. Vende minisséries por R$6." />
                  <Toggle label="Pode responder inline (sem seguir handle)"
                    checked={(node.data.aiAgent as IntentAiAgent).canRespondInline !== false}
                    onChange={v => set('aiAgent', { ...(node.data.aiAgent as IntentAiAgent), canRespondInline: v })} />
                  <div className="mt-3">
                    <p className="text-xs font-medium text-slate-300 mb-1.5">Handles disponíveis para a IA rotear</p>
                    <AvailableHandlesList
                      handles={((node.data.aiAgent as IntentAiAgent).availableHandles ?? [])}
                      onChange={handles => set('aiAgent', { ...(node.data.aiAgent as IntentAiAgent), availableHandles: handles })}
                    />
                  </div>
                </>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-2">Runtime vars: <span className="text-cyan-300 font-mono">__rt_intent</span> · <span className="text-cyan-300 font-mono">__rt_confidence</span> · <span className="text-cyan-300 font-mono">__rt_intent_qty</span> · <span className="text-cyan-300 font-mono">__rt_sentiment</span> · <span className="text-cyan-300 font-mono">__rt_ai_responded</span></p>
          </>
        )}

        {node.type === 'deliver_title' && (
          <>
            <div className="p-3 rounded-xl bg-emerald-400/5 border border-emerald-400/20 mb-2">
              <p className="text-xs text-emerald-300 font-semibold mb-1">Deliver Title — sem IA</p>
              <p className="text-xs text-slate-400">Entrega os produtos encontrados pelo catalog_search, respeitando os slots comprados. Nunca entrega acima do comprado.</p>
            </div>
            <Field label="Template da mensagem" value={String(node.data.messageTemplate ?? '')} onChange={v => set('messageTemplate', v)}
              placeholder="{'{'}{'{'}}name{'}'}{'}'}\n\nAcesso: {'{'}{'{'}}accessLink{'}'}{'}'}"
              hint="Vars disponíveis: {{name}} e {{accessLink}}" />
            <Field label="Var catálogo encontrado" value={String(node.data.catalogVar ?? '')} onChange={v => set('catalogVar', v)}
              placeholder="__rt_catalog_found" />
            <Field label="Var slots restantes" value={String(node.data.remainingSlotsVar ?? '')} onChange={v => set('remainingSlotsVar', v)}
              placeholder="__rt_remaining_slots" />
            <Field label="Var slots entregues" value={String(node.data.deliveredSlotsVar ?? '')} onChange={v => set('deliveredSlotsVar', v)}
              placeholder="__rt_delivered_slots" />
            <Field label="Var títulos entregues" value={String(node.data.deliveredTitlesVar ?? '')} onChange={v => set('deliveredTitlesVar', v)}
              placeholder="__rt_delivered_titles" />
            <Field label="Var pendências" value={String(node.data.pendingTitlesVar ?? '')} onChange={v => set('pendingTitlesVar', v)}
              placeholder="__rt_delivery_pending" />
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input type="checkbox" checked={node.data.notifyOwnerOnMissingLink !== false}
                onChange={e => set('notifyOwnerOnMissingLink', e.target.checked)}
                className="rounded" />
              <span className="text-xs text-slate-300">Notificar owner se produto sem accessLink</span>
            </label>
            <p className="text-xs text-slate-500 mt-2">Handles: <span className="text-emerald-400 font-mono">done</span> · <span className="text-blue-400 font-mono">more</span> · <span className="text-yellow-400 font-mono">partial</span> · <span className="text-red-400 font-mono">error</span></p>
          </>
        )}

        {node.type === 'delay' && (
          <NumberField
            label="Delay (segundos)"
            value={Number(node.data.seconds ?? 2)}
            onChange={v => set('seconds', v)}
            min={1}
            max={30}
          />
        )}
      </div>
    </div>
  )
}

function IntentRuleList({ rules, onChange }: { rules: IntentRule[]; onChange: (r: IntentRule[]) => void }) {
  const inputCls = "bg-transparent border border-glass-border rounded-lg px-2 py-1 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-brand-500/40"
  const update = (i: number, patch: Partial<IntentRule>) => { const n = [...rules]; n[i] = { ...n[i], ...patch }; onChange(n) }
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i))
  const add = () => onChange([...rules, { handle: '' }])
  return (
    <div className="space-y-2">
      {rules.map((rule, i) => (
        <div key={i} className="p-2.5 rounded-xl bg-glass-100 border border-glass-border space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={rule.handle} onChange={e => update(i, { handle: e.target.value })}
              placeholder="handle" className={`w-28 font-mono text-cyan-300 ${inputCls}`} />
            <input value={rule.label ?? ''} onChange={e => update(i, { label: e.target.value })}
              placeholder="label (opcional)" className={`flex-1 ${inputCls}`} />
            <button onClick={() => remove(i)} className="text-slate-600 hover:text-red-400 transition-colors px-1">✕</button>
          </div>
          <input value={(rule.patterns ?? []).join(', ')}
            onChange={e => update(i, { patterns: e.target.value.split(',').map(p => p.trim()).filter(Boolean) })}
            placeholder="patterns: oi, bom dia (OR — qualquer bate)"
            className={`w-full ${inputCls}`} />
          <input value={(rule.keywords ?? []).join(', ')}
            onChange={e => update(i, { keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) })}
            placeholder="keywords: quero, comprar (AND — todos devem aparecer)"
            className={`w-full ${inputCls}`} />
          <div className="flex items-center gap-4 pt-0.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={Boolean(rule.extractNumber)} onChange={e => update(i, { extractNumber: e.target.checked })} className="rounded" />
              <span className="text-xs text-slate-400">Extrair número → <span className="font-mono text-cyan-300">__rt_intent_qty</span></span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={Boolean(rule.isDefault)} onChange={e => update(i, { isDefault: e.target.checked })} className="rounded" />
              <span className="text-xs text-slate-400">Fallback (antes da IA)</span>
            </label>
          </div>
        </div>
      ))}
      <button onClick={add} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">+ Adicionar regra</button>
    </div>
  )
}

function AvailableHandlesList({ handles, onChange }: { handles: Array<{ handle: string; description: string }>; onChange: (h: Array<{ handle: string; description: string }>) => void }) {
  const inputCls = "bg-transparent border border-glass-border rounded-lg px-2 py-1 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-brand-500/40"
  const update = (i: number, patch: Partial<{ handle: string; description: string }>) => { const n = [...handles]; n[i] = { ...n[i], ...patch }; onChange(n) }
  const remove = (i: number) => onChange(handles.filter((_, idx) => idx !== i))
  const add = () => onChange([...handles, { handle: '', description: '' }])
  return (
    <div className="space-y-1.5">
      {handles.map((h, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input value={h.handle} onChange={e => update(i, { handle: e.target.value })}
            placeholder="handle" className={`w-24 font-mono text-cyan-300 ${inputCls}`} />
          <input value={h.description} onChange={e => update(i, { description: e.target.value })}
            placeholder="quando usar (IA lê)" className={`flex-1 ${inputCls}`} />
          <button onClick={() => remove(i)} className="text-slate-600 hover:text-red-400 transition-colors px-1">✕</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-purple-400 hover:text-purple-300 transition-colors">+ Handle</button>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, textarea, hint }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; textarea?: boolean; hint?: string
}) {
  const cls = "w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500/50 transition-all"
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1.5">{label}</label>
      {textarea
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={4} className={`${cls} resize-none font-mono text-xs`} />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

function NumberField({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1.5">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all"
      />
    </div>
  )
}

function VariationsList({ variations, onChange }: { variations: string[]; onChange: (v: string[]) => void }) {
  const cls = "w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500/50 transition-all resize-none font-mono text-xs"
  const update = (i: number, val: string) => { const next = [...variations]; next[i] = val; onChange(next) }
  const remove = (i: number) => onChange(variations.filter((_, idx) => idx !== i))
  const add = () => onChange([...variations, ''])
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1.5">Variações de mensagem</label>
      <div className="space-y-2">
        {variations.map((v, i) => (
          <div key={i} className="flex gap-1.5">
            <textarea value={v} rows={2} onChange={e => update(i, e.target.value)} placeholder={`Variação ${i + 1}`} className={cls} />
            <button onClick={() => remove(i)} className="text-slate-500 hover:text-red-400 transition-colors px-1">✕</button>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-2 text-xs text-brand-400 hover:text-brand-300 transition-colors">+ Adicionar variação</button>
      <p className="text-xs text-slate-500 mt-1">Uma variação é sorteada aleatoriamente a cada execução.</p>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full transition-all duration-200 ${checked ? 'bg-brand-500' : 'bg-glass-300'}`}
      >
        <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 mx-0.5 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all"
      >
        {options.map(o => <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>)}
      </select>
    </div>
  )
}
