import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { X, Settings, ChevronDown, Check } from 'lucide-react'

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
            <Field label="Regex de validação (opcional)" value={String(node.data.validationRegex ?? '')} onChange={v => set('validationRegex', v)} placeholder="^\d+$" />
            <Field label="Mensagem de erro" value={String(node.data.errorMessage ?? '')} onChange={v => set('errorMessage', v)} placeholder="Resposta inválida, tente novamente." />
            <div className="border-t border-white/5 pt-3 mt-1">
              <p className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1">⏱ Timeout (sem resposta)</p>
              <NumberField label="Tempo limite (minutos, 0 = desativado)" value={Number(node.data.timeoutMinutes ?? 0)} onChange={v => set('timeoutMinutes', v)} min={0} max={1440} />
              {Number(node.data.timeoutMinutes ?? 0) > 0 && (
                <>
                  <Field label="Mensagem ao expirar (opcional)" value={String(node.data.timeoutMessage ?? '')} onChange={v => set('timeoutMessage', v)} placeholder="Ainda está aí? 👋" />
                  <p className="text-xs text-slate-500 mt-1">Conecte o handle <span className="text-amber-400">âmbar</span> ao caminho de "sem resposta".</p>
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
              placeholder="email@exemplo.com / CPF / CNPJ / chave aleatória" />
            <Field label="Valor (opcional)" value={String(node.data.amount ?? '')} onChange={v => set('amount', v)}
              placeholder="15.00 ou {{valor}}" hint="Deixe vazio para valor livre." />
            <Field label="Descrição" value={String(node.data.description ?? '')} onChange={v => set('description', v)} placeholder="Plano de receitas fitt" />
            <Field label="Nome do favorecido" value={String(node.data.recipientName ?? '')} onChange={v => set('recipientName', v)} placeholder="João Silva" />
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
