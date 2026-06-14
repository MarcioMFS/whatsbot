import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Save, X, Zap, Brain, Shield, TrendingUp, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, MkButton, Eyebrow } from '../components/mkhub'
import { api } from '../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CapabilityTrigger { type: 'keyword' | 'phrase' | 'state' | 'tag'; value: string; priority: number }

interface Capability {
  id: string; botId: string; name: string; description: string
  examples: string[]; exclusions: string[]; triggers: CapabilityTrigger[]
  flowId: string; isDefault: boolean; isEnabled: boolean; priority: number
  metadata: Record<string, unknown>; createdAt: string; updatedAt: string
}

interface Flow { id: string; name: string }

interface CapabilityMetrics {
  capabilityId: string | null; capabilityName: string
  totalCalls: number; triggerHits: number; aiHits: number; defaultHits: number
  avgConfidence: number; avgLatencyMs: number; successRate: number; wrongRouteRate: number
}

interface DetectedPattern {
  pattern: string; normalizedPattern: string; count: number
  currentMethod: 'default' | 'ai_low_confidence'; examples: string[]
  suggestedAction: 'add_trigger' | 'new_capability' | 'improve_description'
  suggestedCapability?: string
}

const emptyForm = {
  name: '', description: '', examples: '', exclusions: '',
  triggers: [] as CapabilityTrigger[], flowId: '', isDefault: false, isEnabled: true, priority: 50,
}

const TRIGGER_TYPES = ['keyword', 'phrase', 'state', 'tag'] as const

// ─── CapabilityCard ──────────────────────────────────────────────────────────

function CapabilityCard({ cap, metrics, onEdit, onToggle, onDelete }: {
  cap: Capability; metrics?: CapabilityMetrics; onEdit: () => void; onToggle: () => void; onDelete: () => void
}) {
  const triggerRate = metrics && metrics.totalCalls > 0 ? Math.round((metrics.triggerHits / metrics.totalCalls) * 100) : null

  return (
    <MkCard style={{ padding: 20, opacity: cap.isEnabled ? 1 : 0.55 }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div style={{ width: 38, height: 38, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={16} strokeWidth={1.6} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="mk-display" style={{ fontWeight: 600 }}>{cap.name}</span>
              {cap.isDefault && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>default</span>
              )}
              <span className="text-xs" style={{ color: 'var(--muted)' }}>p{cap.priority}</span>
            </div>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{cap.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconBtn onClick={onEdit}><Pencil size={14} /></IconBtn>
          <IconBtn onClick={onToggle}>{cap.isEnabled ? <ToggleRight size={16} style={{ color: '#1d7a52' }} /> : <ToggleLeft size={16} />}</IconBtn>
          <IconBtn onClick={onDelete}><Trash2 size={14} /></IconBtn>
        </div>
      </div>

      {cap.examples.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {cap.examples.slice(0, 4).map((ex, i) => <Chip key={i}>"{ex}"</Chip>)}
          {cap.examples.length > 4 && <Chip muted>+{cap.examples.length - 4} mais</Chip>}
        </div>
      )}

      {cap.triggers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {cap.triggers.map((t, i) => <Chip key={i} mono>{t.type[0]}: {t.value}</Chip>)}
        </div>
      )}

      {metrics && metrics.totalCalls > 0 && (
        <div className="flex gap-4 pt-3 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}>
          <span>{metrics.totalCalls} calls</span>
          {triggerRate !== null && <span style={{ color: triggerRate >= 60 ? '#1d7a52' : '#9a7400' }}>{triggerRate}% trigger</span>}
          <span>{(metrics.avgConfidence * 100).toFixed(0)}% conf.</span>
          <span>{Math.round(metrics.avgLatencyMs)}ms</span>
        </div>
      )}
    </MkCard>
  )
}

function IconBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="p-1.5 rounded-lg hover:opacity-60 transition-all" style={{ color: 'var(--muted)' }}>{children}</button>
}

function Chip({ children, mono, muted }: { children: React.ReactNode; mono?: boolean; muted?: boolean }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full" style={{
      background: 'var(--paper-2)', border: '1px solid var(--line)',
      color: muted ? 'var(--muted)' : 'var(--ink-soft)', fontFamily: mono ? 'monospace' : undefined,
    }}>{children}</span>
  )
}

// ─── TriggerEditor ────────────────────────────────────────────────────────────

function TriggerEditor({ triggers, onChange }: { triggers: CapabilityTrigger[]; onChange: (t: CapabilityTrigger[]) => void }) {
  const add = () => onChange([...triggers, { type: 'keyword', value: '', priority: 5 }])
  const remove = (i: number) => onChange(triggers.filter((_, idx) => idx !== i))
  const update = (i: number, field: keyof CapabilityTrigger, val: unknown) =>
    onChange(triggers.map((t, idx) => idx === i ? { ...t, [field]: val } : t))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Eyebrow style={{ fontSize: '.6rem' }}>Triggers</Eyebrow>
        <button type="button" onClick={add} className="mk-link text-xs" style={{ color: 'var(--ink)' }}>+ Adicionar</button>
      </div>
      {triggers.length === 0 && <p className="text-xs italic" style={{ color: 'var(--muted)' }}>Nenhum trigger — IA decide sempre</p>}
      <div className="space-y-2">
        {triggers.map((t, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select value={t.type} onChange={e => update(i, 'type', e.target.value)} className="mk-input text-xs px-2 py-1.5">
              {TRIGGER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <input value={t.value} onChange={e => update(i, 'value', e.target.value)} placeholder="valor" className="mk-input flex-1 text-xs px-2 py-1.5" />
            <input type="number" min={1} max={10} value={t.priority} onChange={e => update(i, 'priority', parseInt(e.target.value) || 5)} className="mk-input w-14 text-xs px-2 py-1.5" />
            <button type="button" onClick={() => remove(i)} style={{ color: 'var(--muted)' }} className="hover:opacity-60"><X size={14} /></button>
          </div>
        ))}
      </div>
      {triggers.length > 0 && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>tipo · valor · prioridade (1-10)</p>}
    </div>
  )
}

// ─── CapabilityModal ───────────────────────────────────────────────────────────

function CapabilityModal({ initial, prefill, flows, onClose, onSave }: {
  initial?: Capability; prefill?: { name?: string; examples?: string }
  flows: Flow[]; botId: string; onClose: () => void; onSave: (data: unknown) => Promise<void>
}) {
  const [form, setForm] = useState(initial ? {
    name: initial.name, description: initial.description,
    examples: initial.examples.join(', '), exclusions: initial.exclusions.join(', '),
    triggers: [...initial.triggers], flowId: initial.flowId,
    isDefault: initial.isDefault, isEnabled: initial.isEnabled, priority: initial.priority,
  } : { ...emptyForm, ...(prefill ?? {}) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (field: string, val: unknown) => setForm(f => ({ ...f, [field]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Nome é obrigatório')
    if (form.description.trim().length < 20) return setError('Descrição precisa ter pelo menos 20 caracteres')
    if (!form.examples.trim()) return setError('Pelo menos 1 exemplo é obrigatório')
    if (!form.flowId) return setError('Selecione um flow')
    setSaving(true); setError('')
    try {
      await onSave({
        name: form.name.trim(), description: form.description.trim(),
        examples: form.examples.split(',').map(s => s.trim()).filter(Boolean),
        exclusions: form.exclusions.split(',').map(s => s.trim()).filter(Boolean),
        triggers: form.triggers, flowId: form.flowId,
        isDefault: form.isDefault, isEnabled: form.isEnabled, priority: form.priority,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  const lbl = "mk-eyebrow block mb-1.5"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,10,10,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--paper)', borderRadius: 22, border: '1px solid var(--line)', boxShadow: '0 44px 100px -34px rgba(10,10,10,.4)' }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--line)' }}>
          <h2 className="mk-display" style={{ fontSize: '1.2rem', fontWeight: 600 }}>{initial ? 'Editar Capability' : 'Nova Capability'}</h2>
          <button onClick={onClose} style={{ color: 'var(--muted)' }} className="hover:opacity-60"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={lbl} style={{ fontSize: '.62rem' }}>Nome *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Busca de Série" className="mk-input w-full px-3 py-2.5 text-sm" />
            </div>
            <div className="w-24">
              <label className={lbl} style={{ fontSize: '.62rem' }}>Prioridade</label>
              <input type="number" min={1} max={100} value={form.priority} onChange={e => set('priority', parseInt(e.target.value) || 50)} className="mk-input w-full px-3 py-2.5 text-sm" />
            </div>
          </div>

          <div>
            <label className={lbl} style={{ fontSize: '.62rem' }}>Descrição * <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>(mín. 20 chars — a IA usa pra rotear)</span></label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Quando usar essa capability — seja específico" className="mk-input w-full px-3 py-2.5 text-sm resize-none" />
          </div>

          <div>
            <label className={lbl} style={{ fontSize: '.62rem' }}>Exemplos * <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>(separados por vírgula)</span></label>
            <textarea value={form.examples} onChange={e => set('examples', e.target.value)} rows={2} placeholder="vou pagar, aqui o comprovante, fiz o pix" className="mk-input w-full px-3 py-2.5 text-sm resize-none" />
          </div>

          <div>
            <label className={lbl} style={{ fontSize: '.62rem' }}>Exclusões <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>(frases que descartam)</span></label>
            <input value={form.exclusions} onChange={e => set('exclusions', e.target.value)} placeholder="quanto custa, como funciona" className="mk-input w-full px-3 py-2.5 text-sm" />
          </div>

          <div className="p-4 rounded-xl" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
            <TriggerEditor triggers={form.triggers} onChange={t => set('triggers', t)} />
          </div>

          <div>
            <label className={lbl} style={{ fontSize: '.62rem' }}>Flow *</label>
            <select value={form.flowId} onChange={e => set('flowId', e.target.value)} className="mk-input w-full px-3 py-2.5 text-sm">
              <option value="">Selecionar flow...</option>
              {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--ink-soft)' }}>
              <input type="checkbox" checked={form.isEnabled} onChange={e => set('isEnabled', e.target.checked)} style={{ accentColor: 'var(--ink)' }} /> Ativo
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--ink-soft)' }}>
              <input type="checkbox" checked={form.isDefault} onChange={e => set('isDefault', e.target.checked)} style={{ accentColor: 'var(--ink)' }} /> Default (fallback)
            </label>
          </div>

          {error && <p className="text-sm rounded-xl px-3 py-2" style={{ color: '#b42318', background: 'rgba(180,35,24,0.07)' }}>{error}</p>}

          <div className="flex gap-3 pt-2">
            <MkButton type="button" variant="ghost" onClick={onClose} className="flex-1">Cancelar</MkButton>
            <button type="submit" disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all disabled:opacity-50" style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '11px 22px' }}>
              {saving ? <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff' }} /> : <Save size={15} />}
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── PatternsList (B1 feedback loop) ───────────────────────────────────────────

function PatternsList({ patterns, capabilities, onAddTrigger, onCreateFromPattern }: {
  patterns: DetectedPattern[]; capabilities: Capability[]
  onAddTrigger: (pattern: DetectedPattern, capabilityId: string) => Promise<void>
  onCreateFromPattern: (pattern: DetectedPattern) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [pickCap, setPickCap] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  if (patterns.length === 0) return null
  const shown = expanded ? patterns : patterns.slice(0, 5)
  const enabledCaps = capabilities.filter(c => c.isEnabled)

  const actionColor = (p: DetectedPattern) => p.count >= 20 ? '#b42318' : p.count >= 10 ? '#9a7400' : 'var(--ink-soft)'

  const openPicker = (p: DetectedPattern) => {
    const match = enabledCaps.find(c => c.name === p.suggestedCapability)
    setPickCap(match?.id ?? enabledCaps[0]?.id ?? '')
    setPickerFor(p.normalizedPattern)
  }
  const apply = async (p: DetectedPattern) => {
    if (!pickCap) return
    setBusy(p.normalizedPattern)
    try { await onAddTrigger(p, pickCap) } finally { setBusy(null); setPickerFor(null) }
  }

  return (
    <div className="p-5 rounded-2xl" style={{ border: '1px solid rgba(217,163,0,0.3)', background: 'rgba(217,163,0,0.05)' }}>
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={15} style={{ color: '#9a7400' }} />
        <h3 className="mk-display" style={{ fontWeight: 600 }}>Oportunidades de Melhoria</h3>
        <Eyebrow style={{ fontSize: '.58rem', color: '#9a7400' }}>últimos 7 dias</Eyebrow>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
        Mensagens que a IA não entendeu bem. Vire <strong style={{ color: 'var(--ink-soft)' }}>trigger</strong> (resposta determinística) ou crie uma capability nova.
      </p>
      <div className="space-y-2">
        {shown.map((p, i) => (
          <div key={i} className="p-3 rounded-xl" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-medium truncate" style={{ color: actionColor(p) }}>"{p.pattern}"</span>
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{p.count}×</span>
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{p.currentMethod === 'default' ? 'caiu no fallback' : 'baixa conf.'}</span>
              </div>
              {pickerFor !== p.normalizedPattern && (
                <div className="flex items-center gap-2 shrink-0">
                  {enabledCaps.length > 0 && (
                    <button onClick={() => openPicker(p)} className="text-xs px-2.5 py-1 rounded-lg transition-all" style={{ border: '1px solid var(--ink)', color: 'var(--ink)' }}>+ trigger</button>
                  )}
                  <button onClick={() => onCreateFromPattern(p)} className="text-xs px-2.5 py-1 rounded-lg transition-all" style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>+ capability</button>
                </div>
              )}
            </div>
            {pickerFor === p.normalizedPattern && (
              <div className="flex items-center gap-2 mt-2.5">
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>Trigger em:</span>
                <select value={pickCap} onChange={e => setPickCap(e.target.value)} className="mk-input flex-1 min-w-0 text-xs px-2 py-1.5">
                  {enabledCaps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button disabled={busy === p.normalizedPattern} onClick={() => apply(p)} className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 shrink-0" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
                  {busy === p.normalizedPattern ? 'Aplicando...' : 'Aplicar'}
                </button>
                <button onClick={() => setPickerFor(null)} style={{ color: 'var(--muted)' }} className="shrink-0 hover:opacity-60"><X size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      {patterns.length > 5 && (
        <button onClick={() => setExpanded(v => !v)} className="mt-3 flex items-center gap-1 text-xs hover:opacity-60" style={{ color: 'var(--muted)' }}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Mostrar menos' : `Ver mais ${patterns.length - 5} padrões`}
        </button>
      )}
    </div>
  )
}

// ─── Capabilities Page ────────────────────────────────────────────────────────

export function Capabilities() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()

  const [caps, setCaps] = useState<Capability[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [metrics, setMetrics] = useState<CapabilityMetrics[]>([])
  const [patterns, setPatterns] = useState<DetectedPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Capability | null>(null)
  const [creating, setCreating] = useState(false)
  const [prefill, setPrefill] = useState<{ name?: string; examples?: string } | null>(null)
  const [appliedPatterns, setAppliedPatterns] = useState<Set<string>>(new Set())

  const load = async () => {
    if (!botId) return
    setLoading(true)
    try {
      const [capsData, flowsData, metricsData, patternsData] = await Promise.all([
        api.capabilities.list(botId),
        api.flows.list(botId),
        api.capabilities.metrics(botId).catch(() => []),
        api.capabilities.patterns(botId).catch(() => []),
      ])
      setCaps(capsData as Capability[])
      setFlows((flowsData as Flow[]).filter(f => f.id && f.name))
      setMetrics(metricsData as CapabilityMetrics[])
      setPatterns(patternsData as DetectedPattern[])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [botId])

  const getMetrics = (capId: string) => metrics.find(m => m.capabilityId === capId)

  const handleCreate = async (data: unknown) => { await api.capabilities.create(botId!, data); await load() }
  const handleUpdate = async (id: string, data: unknown) => { await api.capabilities.update(id, data); await load() }
  const handleToggle = async (cap: Capability) => { await api.capabilities.toggle(cap.id); await load() }
  const handleDelete = async (cap: Capability) => {
    if (!confirm(`Deletar capability "${cap.name}"?`)) return
    await api.capabilities.delete(cap.id); await load()
  }

  const handleAddTrigger = async (pattern: DetectedPattern, capabilityId: string) => {
    const cap = caps.find(c => c.id === capabilityId)
    if (cap) {
      const exists = cap.triggers.some(t => t.value.toLowerCase() === pattern.normalizedPattern.toLowerCase())
      if (!exists) {
        await api.capabilities.update(capabilityId, {
          triggers: [...cap.triggers, { type: 'keyword', value: pattern.normalizedPattern, priority: 5 }],
        })
      }
    }
    setAppliedPatterns(s => new Set(s).add(pattern.normalizedPattern))
    const capsData = await api.capabilities.list(botId!).catch(() => caps)
    setCaps(capsData as Capability[])
  }

  const handleCreateFromPattern = (pattern: DetectedPattern) => {
    const base = pattern.pattern.trim().slice(0, 40)
    setPrefill({ name: base.charAt(0).toUpperCase() + base.slice(1), examples: pattern.examples.join(', ') })
    setCreating(true)
  }

  const totalCalls = metrics.reduce((s, m) => s + m.totalCalls, 0)
  const totalTrigger = metrics.reduce((s, m) => s + m.triggerHits, 0)
  const triggerRate = totalCalls > 0 ? Math.round((totalTrigger / totalCalls) * 100) : 0
  const avgConf = metrics.length > 0 ? Math.round(metrics.reduce((s, m) => s + m.avgConfidence, 0) / metrics.length * 100) : 0
  const fallbackHits = metrics.reduce((s, m) => s + m.defaultHits, 0)
  const fallbackRate = totalCalls > 0 ? Math.round((fallbackHits / totalCalls) * 100) : 0

  return (
    <MkLayout>
      <div className="max-w-4xl mx-auto space-y-7">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/bots/${botId}`)} className="p-2 rounded-xl hover:opacity-60" style={{ color: 'var(--muted)' }}>
              <ArrowLeft size={18} />
            </button>
            <div>
              <Eyebrow>Capabilities</Eyebrow>
              <h1 className="mk-display" style={{ fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.01em' }}>Capabilities</h1>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Sub-flows que a IA invoca dinamicamente</p>
            </div>
          </div>
          <MkButton onClick={() => { setPrefill(null); setCreating(true) }}><Plus size={16} /> Nova Capability</MkButton>
        </div>

        {/* Metrics */}
        {totalCalls > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Calls', value: totalCalls.toLocaleString(), icon: TrendingUp, color: 'var(--ink)' },
              { label: 'Trigger Rate', value: `${triggerRate}%`, icon: Zap, color: triggerRate >= 60 ? '#1d7a52' : '#9a7400' },
              { label: 'Avg Confidence', value: `${avgConf}%`, icon: Brain, color: avgConf >= 80 ? '#1d7a52' : '#9a7400' },
              { label: 'Fallback Rate', value: `${fallbackRate}%`, icon: Shield, color: fallbackRate <= 5 ? '#1d7a52' : '#b42318' },
            ].map(({ label, value, icon: Icon, color }) => (
              <MkCard key={label} style={{ padding: 18, textAlign: 'center' }}>
                <Icon size={18} strokeWidth={1.6} style={{ color, margin: '0 auto 6px' }} />
                <div className="mk-display" style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{value}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
              </MkCard>
            ))}
          </div>
        )}

        <PatternsList
          patterns={patterns.filter(p => !appliedPatterns.has(p.normalizedPattern))}
          capabilities={caps}
          onAddTrigger={handleAddTrigger}
          onCreateFromPattern={handleCreateFromPattern}
        />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid var(--line)', borderTopColor: 'var(--ink)' }} />
          </div>
        ) : caps.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--muted)' }}>
            <Zap size={40} strokeWidth={1.3} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p className="text-sm">Nenhuma capability ainda.</p>
            <p className="text-xs mt-1">Crie capabilities para que a IA possa rotear conversas dinamicamente.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...caps]
              .sort((a, b) => a.isEnabled !== b.isEnabled ? (a.isEnabled ? -1 : 1) : b.priority - a.priority)
              .map(cap => (
                <CapabilityCard key={cap.id} cap={cap} metrics={getMetrics(cap.id)}
                  onEdit={() => setEditing(cap)} onToggle={() => handleToggle(cap)} onDelete={() => handleDelete(cap)} />
              ))}
          </div>
        )}
      </div>

      {creating && (
        <CapabilityModal prefill={prefill ?? undefined} flows={flows} botId={botId!} onClose={() => { setCreating(false); setPrefill(null) }} onSave={handleCreate} />
      )}
      {editing && (
        <CapabilityModal initial={editing} flows={flows} botId={botId!} onClose={() => setEditing(null)} onSave={data => handleUpdate(editing.id, data)} />
      )}
    </MkLayout>
  )
}
