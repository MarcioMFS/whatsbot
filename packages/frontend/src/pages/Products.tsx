import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Package, Pencil, Trash2, Eye, EyeOff, Save, X } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, MkField, MkSwitch, Eyebrow } from '../components/mkhub'
import { api } from '../api/client'

interface Product {
  id: string; name: string; description?: string; priceCentavos: number
  category?: string; isAvailable: boolean; accessLink?: string; aliases: string[]
}

const emptyForm = { name: '', description: '', priceCentavos: '', category: '', accessLink: '', aliases: '', isAvailable: true }

const formatBRL = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`
function parsePriceToCentavos(raw: string): number {
  const val = parseFloat(raw.replace(/[^\d,]/g, '').replace(',', '.'))
  return isNaN(val) ? 0 : Math.round(val * 100)
}

export function Products({ embedded = false }: { embedded?: boolean } = {}) {
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
    try { setProducts(await api.products.list(botId, showUnavailable) as Product[]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [botId, showUnavailable])

  const resetForm = () => { setForm(emptyForm); setEditing(null) }
  const startEdit = (p: Product) => {
    setEditing(p.id)
    setForm({
      name: p.name, description: p.description ?? '',
      priceCentavos: (p.priceCentavos / 100).toFixed(2).replace('.', ','),
      category: p.category ?? '', accessLink: p.accessLink ?? '',
      aliases: p.aliases.join(', '), isAvailable: p.isAvailable,
    })
  }

  const handleSave = async () => {
    if (!botId || !form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(), description: form.description.trim() || undefined,
        priceCentavos: parsePriceToCentavos(form.priceCentavos),
        category: form.category.trim() || undefined, accessLink: form.accessLink.trim() || undefined,
        aliases: form.aliases.split(',').map(a => a.trim()).filter(Boolean), isAvailable: form.isAvailable,
      }
      if (editing) await api.products.update(editing, payload)
      else await api.products.create(botId, payload)
      await load(); resetForm()
    } finally { setSaving(false) }
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

  const setF = (k: keyof typeof emptyForm, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const body = (
    <>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-7">
          <button onClick={() => navigate(-1)} className="hover:opacity-60" style={{ color: 'var(--muted)' }}><ArrowLeft size={18} /></button>
          <div className="flex-1">
            <Eyebrow>Catálogo</Eyebrow>
            <h1 className="mk-display" style={{ fontSize: '1.7rem', fontWeight: 700 }}>Catálogo de Produtos</h1>
            <p className="text-xs" style={{ color: 'var(--muted)', marginTop: 2 }}>{products.length} produto{products.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowUnavailable(v => !v)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
            {showUnavailable ? <Eye size={12} /> : <EyeOff size={12} />} {showUnavailable ? 'Ocultar indisponíveis' : 'Mostrar todos'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="lg:col-span-2 space-y-2">
            {loading && <div className="text-center py-8 text-sm" style={{ color: 'var(--muted)' }}>Carregando...</div>}
            {!loading && products.length === 0 && (
              <MkCard style={{ padding: '48px 0', textAlign: 'center' }}>
                <Package size={28} strokeWidth={1.4} style={{ margin: '0 auto 12px', color: 'var(--muted)' }} />
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Nenhum produto cadastrado.</p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Adicione produtos no painel ao lado.</p>
              </MkCard>
            )}
            {products.map(p => (
              <MkCard key={p.id} style={{ padding: 16, opacity: p.isAvailable ? 1 : 0.6, border: editing === p.id ? '1px solid var(--ink)' : '1px solid var(--line)' }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" style={{ color: 'var(--ink)' }}>{p.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--paper-2)', border: `1px solid ${p.isAvailable ? '#1d7a52' : 'var(--muted)'}40`, color: p.isAvailable ? '#1d7a52' : 'var(--muted)' }}>
                        {p.isAvailable ? 'disponível' : 'indisponível'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{formatBRL(p.priceCentavos)}</span>
                      {p.category && <span className="text-xs" style={{ color: 'var(--muted)' }}>{p.category}</span>}
                    </div>
                    {p.aliases.length > 0 && <p className="text-xs mt-1 truncate" style={{ color: 'var(--muted)' }}>aliases: {p.aliases.join(', ')}</p>}
                    {p.accessLink && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>🔗 {p.accessLink}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleAvailability(p)} title={p.isAvailable ? 'Desativar' : 'Ativar'} className="p-1.5 rounded-lg hover:opacity-60" style={{ color: 'var(--muted)' }}>
                      {p.isAvailable ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={() => editing === p.id ? resetForm() : startEdit(p)} className="p-1.5 rounded-lg hover:opacity-60" style={{ color: editing === p.id ? 'var(--ink)' : 'var(--muted)' }}><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg hover:opacity-60" style={{ color: 'var(--muted)' }}><Trash2 size={14} /></button>
                  </div>
                </div>
              </MkCard>
            ))}
          </div>

          {/* Form */}
          <MkCard style={{ padding: 20, height: 'fit-content' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="mk-display" style={{ fontWeight: 600, fontSize: '.95rem' }}>{editing ? 'Editar produto' : 'Novo produto'}</h2>
              {editing && <button onClick={resetForm} style={{ color: 'var(--muted)' }} className="hover:opacity-60"><X size={16} /></button>}
            </div>
            <div className="space-y-4">
              <MkField label="Nome *" value={form.name} onChange={v => setF('name', v)} placeholder="Ex: Crash Landing on You" />
              <MkField label="Preço (R$) *" value={form.priceCentavos} onChange={v => setF('priceCentavos', v)} placeholder="6,00" />
              <div>
                <MkField label="Link de acesso" value={form.accessLink} onChange={v => setF('accessLink', v)} placeholder="https://..." />
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Enviado automaticamente após pagamento confirmado</p>
              </div>
              <div>
                <MkField label="Aliases (separados por vírgula)" value={form.aliases} onChange={v => setF('aliases', v)} placeholder="pousando no amor, crash landing" />
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Usados na busca por nome alternativo</p>
              </div>
              <MkField label="Categoria" value={form.category} onChange={v => setF('category', v)} placeholder="K-drama" />
              <div>
                <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Descrição</label>
                <textarea value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Descrição opcional..." rows={2} className="mk-input w-full px-3 py-2.5 text-sm resize-none" />
              </div>
              <div className="flex items-center gap-2.5">
                <MkSwitch on={form.isAvailable} onChange={() => setF('isAvailable', !form.isAvailable)} />
                <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>{form.isAvailable ? 'Disponível' : 'Indisponível'}</span>
              </div>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all disabled:opacity-50"
                style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '11px 0' }}>
                {saving ? <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff' }} /> : <Save size={14} />}
                {editing ? 'Salvar alterações' : 'Criar produto'}
              </button>
            </div>
          </MkCard>
        </div>
      </div>
    </>
  )
  return embedded ? body : <MkLayout>{body}</MkLayout>
}
