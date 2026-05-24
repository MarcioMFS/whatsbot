import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Package, Pencil, Trash2, Eye, EyeOff, Save, X } from 'lucide-react'
import { Layout } from '../components/ui/Layout'
import { api } from '../api/client'

interface Product {
  id: string
  name: string
  description?: string
  priceCentavos: number
  category?: string
  isAvailable: boolean
  accessLink?: string
  aliases: string[]
}

const emptyForm = {
  name: '',
  description: '',
  priceCentavos: '',
  category: '',
  accessLink: '',
  aliases: '',
  isAvailable: true,
}

function formatBRL(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`
}

function parsePriceToCentavos(raw: string): number {
  const cleaned = raw.replace(/[^\d,]/g, '').replace(',', '.')
  const val = parseFloat(cleaned)
  if (isNaN(val)) return 0
  return Math.round(val * 100)
}

export function Products() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showUnavailable, setShowUnavailable] = useState(true)

  const load = async () => {
    if (!botId) return
    setLoading(true)
    try {
      const data = await api.products.list(botId, showUnavailable)
      setProducts(data as Product[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [botId, showUnavailable])

  const resetForm = () => {
    setForm(emptyForm)
    setEditing(null)
  }

  const startEdit = (p: Product) => {
    setEditing(p.id)
    setForm({
      name: p.name,
      description: p.description ?? '',
      priceCentavos: (p.priceCentavos / 100).toFixed(2).replace('.', ','),
      category: p.category ?? '',
      accessLink: p.accessLink ?? '',
      aliases: p.aliases.join(', '),
      isAvailable: p.isAvailable,
    })
  }

  const handleSave = async () => {
    if (!botId || !form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        priceCentavos: parsePriceToCentavos(form.priceCentavos),
        category: form.category.trim() || undefined,
        accessLink: form.accessLink.trim() || undefined,
        aliases: form.aliases.split(',').map(a => a.trim()).filter(Boolean),
        isAvailable: form.isAvailable,
      }

      if (editing) {
        await api.products.update(editing, payload)
      } else {
        await api.products.create(botId, payload)
      }
      await load()
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Deletar produto?')) return
    await api.products.delete(id)
    setProducts(prev => prev.filter(p => p.id !== id))
    if (editing === id) resetForm()
  }

  const toggleAvailability = async (p: Product) => {
    await api.products.update(p.id, { isAvailable: !p.isAvailable })
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, isAvailable: !x.isAvailable } : x))
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Catálogo de Produtos</h1>
            <p className="text-slate-400 text-xs mt-0.5">{products.length} produto{products.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowUnavailable(v => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-glass-100 border border-glass-border px-3 py-1.5 rounded-lg transition-all"
          >
            {showUnavailable ? <Eye size={12} /> : <EyeOff size={12} />}
            {showUnavailable ? 'Ocultar indisponíveis' : 'Mostrar todos'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Product list */}
          <div className="lg:col-span-2 space-y-2">
            {loading && <div className="text-center py-8 text-slate-500 text-sm">Carregando...</div>}
            {!loading && products.length === 0 && (
              <div className="glass border border-glass-border rounded-xl py-12 text-center">
                <Package size={28} className="text-slate-500 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">Nenhum produto cadastrado.</p>
                <p className="text-slate-500 text-xs mt-1">Adicione produtos no painel ao lado.</p>
              </div>
            )}
            {products.map(p => (
              <div key={p.id} className={`glass border rounded-xl p-4 transition-all ${editing === p.id ? 'border-brand-500/40' : 'border-glass-border'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-white text-sm">{p.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${p.isAvailable ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-slate-500/15 border-slate-500/30 text-slate-400'}`}>
                        {p.isAvailable ? 'disponível' : 'indisponível'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-brand-400 text-sm font-semibold">{formatBRL(p.priceCentavos)}</span>
                      {p.category && <span className="text-slate-500 text-xs">{p.category}</span>}
                    </div>
                    {p.aliases.length > 0 && (
                      <p className="text-slate-500 text-xs mt-1 truncate">aliases: {p.aliases.join(', ')}</p>
                    )}
                    {p.accessLink && (
                      <p className="text-slate-500 text-xs mt-0.5 truncate">🔗 {p.accessLink}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleAvailability(p)} title={p.isAvailable ? 'Desativar' : 'Ativar'}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-all">
                      {p.isAvailable ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={() => editing === p.id ? resetForm() : startEdit(p)}
                      className={`p-1.5 rounded-lg transition-all ${editing === p.id ? 'text-brand-400 bg-brand-500/10' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-all">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Form panel */}
          <div className="glass border border-glass-border rounded-xl p-5 h-fit">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white text-sm">{editing ? 'Editar produto' : 'Novo produto'}</h2>
              {editing && (
                <button onClick={resetForm} className="text-slate-400 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Nome *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Crash Landing on You"
                  className="w-full bg-black/30 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50" />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Preço (R$) *</label>
                <input value={form.priceCentavos} onChange={e => setForm(f => ({ ...f, priceCentavos: e.target.value }))}
                  placeholder="6,00"
                  className="w-full bg-black/30 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50" />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Link de acesso</label>
                <input value={form.accessLink} onChange={e => setForm(f => ({ ...f, accessLink: e.target.value }))}
                  placeholder="https://..."
                  className="w-full bg-black/30 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50" />
                <p className="text-slate-500 text-xs mt-1">Enviado automaticamente após pagamento confirmado</p>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Aliases (separados por vírgula)</label>
                <input value={form.aliases} onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))}
                  placeholder="pousando no amor, crash landing"
                  className="w-full bg-black/30 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50" />
                <p className="text-slate-500 text-xs mt-1">Usados na busca por nome alternativo</p>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Categoria</label>
                <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="K-drama"
                  className="w-full bg-black/30 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50" />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Descrição</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descrição opcional..."
                  rows={2}
                  className="w-full bg-black/30 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50 resize-none" />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setForm(f => ({ ...f, isAvailable: !f.isAvailable }))}
                  className={`w-9 h-5 rounded-full transition-all ${form.isAvailable ? 'bg-brand-500' : 'bg-slate-600'}`}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${form.isAvailable ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span className="text-xs text-slate-400">{form.isAvailable ? 'Disponível' : 'Indisponível'}</span>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-all"
              >
                {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
                {editing ? 'Salvar alterações' : 'Criar produto'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
