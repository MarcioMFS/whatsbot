import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Save, X, Zap, Brain, Shield, TrendingUp, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Layout } from '../components/ui/Layout'
import { api } from '../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CapabilityTrigger {
  type: 'keyword' | 'phrase' | 'state' | 'tag'
  value: string
  priority: number
}

interface Capability {
  id: string
  botId: string
  name: string
  description: string
  examples: string[]
  exclusions: string[]
  triggers: CapabilityTrigger[]
  flowId: string
  isDefault: boolean
  isEnabled: boolean
  priority: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface Flow { id: string; name: string }

interface CapabilityMetrics {
  capabilityId: string | null
  capabilityName: string
  totalCalls: number
  triggerHits: number
  aiHits: number
  defaultHits: number
  avgConfidence: number
  avgLatencyMs: number
  successRate: number
  wrongRouteRate: number
}

interface DetectedPattern {
  pattern: string
  normalizedPattern: string
  count: number
  currentMethod: 'default' | 'ai_low_confidence'
  examples: string[]
  suggestedAction: 'add_trigger' | 'new_capability' | 'improve_description'
  suggestedCapability?: string
}

const emptyForm = {
  name: '',
  description: '',
  examples: '',        // comma-separated
  exclusions: '',
  triggers: [] as CapabilityTrigger[],
  flowId: '',
  isDefault: false,
  isEnabled: true,
  priority: 50,
}

const TRIGGER_TYPES = ['keyword', 'phrase', 'state', 'tag'] as const

// ─── CapabilityCard ──────────────────────────────────────────────────────────

function CapabilityCard({
  cap, metrics, onEdit, onToggle, onDelete,
}: {
  cap: Capability
  metrics?: CapabilityMetrics
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const triggerRate = metrics && metrics.totalCalls > 0
    ? Math.round((metrics.triggerHits / metrics.totalCalls) * 100)
    : null

  return (
    <div className={`p-5 rounded-2xl border transition-all ${
      cap.isEnabled
        ? 'border-white/10 bg-white/5 hover:bg-white/[0.07]'
        : 'border-white/5 bg-white/[0.02] opacity-60'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <Zap className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{cap.name}</span>
              {cap.isDefault && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  default
                </span>
              )}
              <span className="text-xs text-white/40">p{cap.priority}</span>
            </div>
            <p className="text-sm text-white/60 mt-0.5">{cap.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onToggle} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all">
            {cap.isEnabled ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />}
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Examples */}
      {cap.examples.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {cap.examples.slice(0, 4).map((ex, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10">
              "{ex}"
            </span>
          ))}
          {cap.examples.length > 4 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">
              +{cap.examples.length - 4} mais
            </span>
          )}
        </div>
      )}

      {/* Triggers */}
      {cap.triggers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {cap.triggers.map((t, i) => (
            <span key={i} className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
              t.type === 'state' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' :
              t.type === 'tag'   ? 'bg-blue-500/10 text-blue-300 border-blue-500/30' :
              t.type === 'phrase'? 'bg-green-500/10 text-green-300 border-green-500/30' :
                                   'bg-purple-500/10 text-purple-300 border-purple-500/30'
            }`}>
              {t.type[0]}: {t.value}
            </span>
          ))}
        </div>
      )}

      {/* Metrics */}
      {metrics && metrics.totalCalls > 0 && (
        <div className="flex gap-4 pt-3 border-t border-white/5 text-xs text-white/40">
          <span>{metrics.totalCalls} calls</span>
          {triggerRate !== null && <span className={triggerRate >= 60 ? 'text-green-400' : 'text-amber-400'}>{triggerRate}% trigger</span>}
          <span>{(metrics.avgConfidence * 100).toFixed(0)}% conf.</span>
          <span>{Math.round(metrics.avgLatencyMs)}ms</span>
        </div>
      )}
    </div>
  )
}

// ─── TriggerEditor ────────────────────────────────────────────────────────────

function TriggerEditor({
  triggers, onChange,
}: {
  triggers: CapabilityTrigger[]
  onChange: (t: CapabilityTrigger[]) => void
}) {
  const add = () => onChange([...triggers, { type: 'keyword', value: '', priority: 5 }])
  const remove = (i: number) => onChange(triggers.filter((_, idx) => idx !== i))
  const update = (i: number, field: keyof CapabilityTrigger, val: unknown) => {
    const next = triggers.map((t, idx) => idx === i ? { ...t, [field]: val } : t)
    onChange(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-white/50 uppercase tracking-wider">Triggers</label>
        <button type="button" onClick={add} className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
          + Adicionar
        </button>
      </div>
      {triggers.length === 0 && (
        <p className="text-xs text-white/30 italic">Nenhum trigger — IA decide sempre</p>
      )}
      <div className="space-y-2">
        {triggers.map((t, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={t.type}
              onChange={e => update(i, 'type', e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:border-purple-500/50"
            >
              {TRIGGER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <input
              value={t.value}
              onChange={e => update(i, 'value', e.target.value)}
              placeholder="valor"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
            />
            <input
              type="number"
              min={1} max={10}
              value={t.priority}
              onChange={e => update(i, 'priority', parseInt(e.target.value) || 5)}
              className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:border-purple-500/50"
            />
            <button type="button" onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      {triggers.length > 0 && (
        <p className="text-xs text-white/30 mt-1">tipo · valor · prioridade (1-10)</p>
      )}
    </div>
  )
}

// ─── CapabilityForm (modal) ───────────────────────────────────────────────────

function CapabilityModal({
  initial, flows, botId, onClose, onSave,
}: {
  initial?: Capability
  flows: Flow[]
  botId: string
  onClose: () => void
  onSave: (data: unknown) => Promise<void>
}) {
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    description: initial.description,
    examples: initial.examples.join(', '),
    exclusions: initial.exclusions.join(', '),
    triggers: [...initial.triggers],
    flowId: initial.flowId,
    isDefault: initial.isDefault,
    isEnabled: initial.isEnabled,
    priority: initial.priority,
  } : emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (field: string, val: unknown) => setForm(f => ({ ...f, [field]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Nome é obrigatório')
    if (form.description.trim().length < 20) return setError('Descrição precisa ter pelo menos 20 caracteres')
    if (!form.examples.trim()) return setError('Pelo menos 1 exemplo é obrigatório')
    if (!form.flowId) return setError('Selecione um flow')

    setSaving(true)
    setError('')
    try {
      await onSave({
        name: form.name.trim(),
        description: form.description.trim(),
        examples: form.examples.split(',').map(s => s.trim()).filter(Boolean),
        exclusions: form.exclusions.split(',').map(s => s.trim()).filter(Boolean),
        triggers: form.triggers,
        flowId: form.flowId,
        isDefault: form.isDefault,
        isEnabled: form.isEnabled,
        priority: form.priority,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">
            {initial ? 'Editar Capability' : 'Nova Capability'}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name + Priority */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Nome *</label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Ex: Busca de Série"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Prioridade</label>
              <input
                type="number" min={1} max={100}
                value={form.priority}
                onChange={e => set('priority', parseInt(e.target.value) || 50)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/50"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">
              Descrição * <span className="text-white/30">(mín. 20 chars — a IA usa isso para rotear)</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              placeholder="Quando usar essa capability — seja específico"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50 resize-none"
            />
          </div>

          {/* Examples */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">
              Exemplos * <span className="text-white/30">(separados por vírgula)</span>
            </label>
            <textarea
              value={form.examples}
              onChange={e => set('examples', e.target.value)}
              rows={2}
              placeholder="vou pagar, aqui o comprovante, fiz o pix"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50 resize-none"
            />
          </div>

          {/* Exclusions */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">
              Exclusões <span className="text-white/30">(frases que descartam essa capability)</span>
            </label>
            <input
              value={form.exclusions}
              onChange={e => set('exclusions', e.target.value)}
              placeholder="quanto custa, como funciona"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          {/* Triggers */}
          <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02]">
            <TriggerEditor triggers={form.triggers} onChange={t => set('triggers', t)} />
          </div>

          {/* Flow */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Flow *</label>
            <select
              value={form.flowId}
              onChange={e => set('flowId', e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/50"
            >
              <option value="">Selecionar flow...</option>
              {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          {/* Flags */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isEnabled} onChange={e => set('isEnabled', e.target.checked)}
                className="w-4 h-4 accent-purple-500" />
              <span className="text-sm text-white/70">Ativo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isDefault} onChange={e => set('isDefault', e.target.checked)}
                className="w-4 h-4 accent-blue-500" />
              <span className="text-sm text-white/70">Default (fallback)</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/60 hover:text-white hover:bg-white/5 transition-all">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-sm font-medium text-white transition-all flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── PatternsList ──────────────────────────────────────────────────────────────

function PatternsList({ patterns }: { patterns: DetectedPattern[] }) {
  const [expanded, setExpanded] = useState(false)
  if (patterns.length === 0) return null

  const shown = expanded ? patterns : patterns.slice(0, 5)

  const actionLabel = (p: DetectedPattern) => {
    if (p.suggestedAction === 'add_trigger') return `Adicionar trigger em "${p.suggestedCapability ?? '?'}"`
    if (p.suggestedAction === 'improve_description') return `Melhorar descrição de "${p.suggestedCapability ?? '?'}"`
    return 'Criar nova capability'
  }

  const actionColor = (p: DetectedPattern) => {
    if (p.count >= 20) return 'text-red-400'
    if (p.count >= 10) return 'text-amber-400'
    return 'text-yellow-400/70'
  }

  return (
    <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <h3 className="font-medium text-white">Oportunidades de Melhoria</h3>
        <span className="text-xs text-amber-400/70">últimos 7 dias</span>
      </div>
      <div className="space-y-2">
        {shown.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${actionColor(p)}`}>
                "{p.pattern}"
              </span>
              <span className="text-xs text-white/30">{p.count}×</span>
              <span className="text-xs text-white/20">
                {p.currentMethod === 'default' ? 'caiu no fallback' : `baixa conf.`}
              </span>
            </div>
            <span className="text-xs text-white/40 shrink-0">{actionLabel(p)}</span>
          </div>
        ))}
      </div>
      {patterns.length > 5 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-3 flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [botId])

  const getMetrics = (capId: string) => metrics.find(m => m.capabilityId === capId)

  const handleCreate = async (data: unknown) => {
    await api.capabilities.create(botId!, data)
    await load()
  }

  const handleUpdate = async (id: string, data: unknown) => {
    await api.capabilities.update(id, data)
    await load()
  }

  const handleToggle = async (cap: Capability) => {
    await api.capabilities.toggle(cap.id)
    await load()
  }

  const handleDelete = async (cap: Capability) => {
    if (!confirm(`Deletar capability "${cap.name}"?`)) return
    await api.capabilities.delete(cap.id)
    await load()
  }

  // Summary metrics
  const totalCalls = metrics.reduce((s, m) => s + m.totalCalls, 0)
  const totalTrigger = metrics.reduce((s, m) => s + m.triggerHits, 0)
  const triggerRate = totalCalls > 0 ? Math.round((totalTrigger / totalCalls) * 100) : 0
  const avgConf = metrics.length > 0
    ? Math.round(metrics.reduce((s, m) => s + m.avgConfidence, 0) / metrics.length * 100)
    : 0
  const fallbackHits = metrics.reduce((s, m) => s + m.defaultHits, 0)
  const fallbackRate = totalCalls > 0 ? Math.round((fallbackHits / totalCalls) * 100) : 0

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/bots/${botId}`)}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-all">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">Capabilities</h1>
              <p className="text-sm text-white/40">Sub-flows que a IA invoca dinamicamente</p>
            </div>
          </div>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-sm font-medium text-white transition-all">
            <Plus className="w-4 h-4" />
            Nova Capability
          </button>
        </div>

        {/* Metrics summary (only if we have data) */}
        {totalCalls > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Calls', value: totalCalls.toLocaleString(), icon: TrendingUp, color: 'text-blue-400' },
              { label: 'Trigger Rate', value: `${triggerRate}%`, icon: Zap, color: triggerRate >= 60 ? 'text-green-400' : 'text-amber-400' },
              { label: 'Avg Confidence', value: `${avgConf}%`, icon: Brain, color: avgConf >= 80 ? 'text-green-400' : 'text-amber-400' },
              { label: 'Fallback Rate', value: `${fallbackRate}%`, icon: Shield, color: fallbackRate <= 5 ? 'text-green-400' : 'text-red-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="p-4 rounded-2xl border border-white/10 bg-white/5 text-center">
                <Icon className={`w-5 h-5 ${color} mx-auto mb-1`} />
                <div className={`text-xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-white/40">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Patterns */}
        <PatternsList patterns={patterns} />

        {/* Capabilities list */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          </div>
        ) : caps.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhuma capability ainda.</p>
            <p className="text-xs mt-1">Crie capabilities para que a IA possa rotear conversas dinamicamente.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Sorted: enabled first, then by priority */}
            {[...caps]
              .sort((a, b) => {
                if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1
                return b.priority - a.priority
              })
              .map(cap => (
                <CapabilityCard
                  key={cap.id}
                  cap={cap}
                  metrics={getMetrics(cap.id)}
                  onEdit={() => setEditing(cap)}
                  onToggle={() => handleToggle(cap)}
                  onDelete={() => handleDelete(cap)}
                />
              ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {creating && (
        <CapabilityModal
          flows={flows}
          botId={botId!}
          onClose={() => setCreating(false)}
          onSave={handleCreate}
        />
      )}
      {editing && (
        <CapabilityModal
          initial={editing}
          flows={flows}
          botId={botId!}
          onClose={() => setEditing(null)}
          onSave={data => handleUpdate(editing.id, data)}
        />
      )}
    </Layout>
  )
}
