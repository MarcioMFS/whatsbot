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

  const allVars = [...new Set([...systemVars, ...capturedVars])]

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
        <Field label="Label" value={String(node.data.label ?? '')} onChange={v => set('label', v)} />

        {node.type === 'text_message' && (
          <Field label="Message" value={String(node.data.message ?? '')} onChange={v => set('message', v)} textarea
            hint="Use {{variable_name}} to insert captured values." />
        )}

        {node.type === 'ai_response' && (
          <>
            <Field label="Prompt Template" value={String(node.data.promptTemplate ?? '')} onChange={v => set('promptTemplate', v)} textarea
              hint="Use {{user_message}}, {{variable_name}}" />
            <Toggle label="Include conversation history" checked={Boolean(node.data.useHistory)} onChange={v => set('useHistory', v)} />
          </>
        )}

        {node.type === 'condition' && (
          <>
            <Field label="Variable" value={String(node.data.variable ?? '')} onChange={v => set('variable', v)} placeholder="e.g. user_choice" />
            <Select label="Operator" value={String(node.data.operator ?? 'equals')} onChange={v => set('operator', v)}
              options={[
                { value: 'equals', label: 'Equals' },
                { value: 'contains', label: 'Contains' },
                { value: 'starts_with', label: 'Starts with' },
                { value: 'regex', label: 'Regex' },
              ]} />
            <Field label="Value" value={String(node.data.value ?? '')} onChange={v => set('value', v)} />
            <p className="text-xs text-slate-500">Connect <span className="text-emerald-400">true</span> and <span className="text-red-400">false</span> handles to different paths.</p>
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
