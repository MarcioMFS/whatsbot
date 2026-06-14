import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Tag, Pencil, Trash2, ToggleLeft, ToggleRight, Save, X } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, MkButton, Eyebrow } from '../components/mkhub'
import { api } from '../api/client'

interface PackageOffer {
  id: string; name: string; description?: string
  type: 'quantity_bundle' | 'fixed_bundle'; pricingMode: 'exact_quantity' | 'minimum_quantity'
  quantity: number; priceCentavos: number; isActive: boolean
}

const emptyForm = {
  name: '', description: '',
  type: 'quantity_bundle' as 'quantity_bundle' | 'fixed_bundle',
  pricingMode: 'minimum_quantity' as 'exact_quantity' | 'minimum_quantity',
  quantity: '', priceCentavos: '',
}

const formatBRL = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`
function parsePriceToCentavos(raw: string): number {
  const val = parseFloat(raw.replace(/[^\d,]/g, '').replace(',', '.'))
  return isNaN(val) ? 0 : Math.round(val * 100)
}

export function PackageOffers() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [offers, setOffers] = useState<PackageOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showInactive, setShowInactive] = useState(true)

  const load = async () => {
    if (!botId) return
    setLoading(true)
    try { setOffers(await api.packageOffers.list(botId, showInactive) as PackageOffer[]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [botId, showInactive])

  const resetForm = () => { setForm(emptyForm); setEditing(null) }
  const startEdit = (o: PackageOffer) => {
    setEditing(o.id)
    setForm({ name: o.name, description: o.description ?? '', type: o.type, pricingMode: o.pricingMode, quantity: String(o.quantity), priceCentavos: (o.priceCentavos / 100).toFixed(2).replace('.', ',') })
  }

  const handleSave = async () => {
    if (!botId || !form.name || !form.quantity || !form.priceCentavos) return
    setSaving(true)
    try {
      const payload = { name: form.name, description: form.description || undefined, type: form.type, pricingMode: form.pricingMode, quantity: parseInt(form.quantity, 10), priceCentavos: parsePriceToCentavos(form.priceCentavos) }
      if (editing) await api.packageOffers.update(editing, payload)
      else await api.packageOffers.create(botId, payload)
      resetForm(); await load()
    } finally { setSaving(false) }
  }

  const handleToggle = async (id: string) => { await api.packageOffers.toggle(id); await load() }
  const handleDelete = async (id: string) => { if (!confirm('Remover este pacote?')) return; await api.packageOffers.delete(id); await load() }

  const setF = (k: keyof typeof emptyForm, v: unknown) => setForm(f => ({ ...f, [k]: v }))
  const activeOffers = offers.filter(o => o.isActive)
  const inactiveOffers = offers.filter(o => !o.isActive)
  const lbl = "mk-eyebrow block mb-1.5"

  return (
    <MkLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate(`/bots/${botId}/config`)} className="p-2 rounded-xl hover:opacity-60" style={{ color: 'var(--muted)' }}><ArrowLeft size={18} /></button>
          <div>
            <Eyebrow>Catálogo</Eyebrow>
            <h1 className="mk-display flex items-center gap-2" style={{ fontSize: '1.7rem', fontWeight: 700 }}><Tag size={22} strokeWidth={1.7} /> Pacotes / Ofertas</h1>
            <p className="text-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>Regras de preço aplicadas ao carrinho — não substituem produtos</p>
          </div>
        </div>

        <div className="mb-6 p-4 rounded-xl text-sm" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)', color: 'var(--ink-soft)' }}>
          <strong>Arquitetura:</strong> Produto → Carrinho → <strong>PricingService → Pacote</strong> → Checkout. O pacote apenas altera o preço final.
        </div>

        {/* Form */}
        <MkCard style={{ padding: 20, marginBottom: 32 }}>
          <h2 className="mk-display mb-4" style={{ fontWeight: 600 }}>{editing ? 'Editar Pacote' : 'Novo Pacote'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <input value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Nome do pacote (ex: 3 séries)" className="mk-input col-span-2 px-3 py-2.5 text-sm" />
            <input value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Descrição (opcional)" className="mk-input col-span-2 px-3 py-2.5 text-sm" />
            <div>
              <label className={lbl} style={{ fontSize: '.62rem' }}>Quantidade de itens</label>
              <input type="number" min="1" value={form.quantity} onChange={e => setF('quantity', e.target.value)} placeholder="ex: 3" className="mk-input w-full px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className={lbl} style={{ fontSize: '.62rem' }}>Preço do pacote (R$)</label>
              <input value={form.priceCentavos} onChange={e => setF('priceCentavos', e.target.value)} placeholder="ex: 13,00" className="mk-input w-full px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className={lbl} style={{ fontSize: '.62rem' }}>Modo de precificação</label>
              <select value={form.pricingMode} onChange={e => setF('pricingMode', e.target.value)} className="mk-input w-full px-3 py-2.5 text-sm">
                <option value="minimum_quantity">Quantidade mínima (≥ N itens)</option>
                <option value="exact_quantity">Quantidade exata (= N itens)</option>
              </select>
            </div>
            <div>
              <label className={lbl} style={{ fontSize: '.62rem' }}>Tipo</label>
              <select value={form.type} onChange={e => setF('type', e.target.value)} className="mk-input w-full px-3 py-2.5 text-sm">
                <option value="quantity_bundle">Pacote por quantidade</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <MkButton onClick={handleSave} disabled={saving || !form.name || !form.quantity || !form.priceCentavos}>
              <Save size={14} /> {saving ? 'Salvando...' : editing ? 'Atualizar' : 'Criar Pacote'}
            </MkButton>
            {editing && <MkButton variant="ghost" onClick={resetForm}><X size={14} /> Cancelar</MkButton>}
          </div>
        </MkCard>

        {/* List */}
        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--muted)' }}>Carregando...</div>
        ) : offers.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--muted)' }}>
            <Tag size={40} strokeWidth={1.3} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p>Nenhum pacote criado ainda.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeOffers.map(o => <OfferRow key={o.id} offer={o} onEdit={() => startEdit(o)} onToggle={() => handleToggle(o.id)} onDelete={() => handleDelete(o.id)} />)}
            {showInactive && inactiveOffers.length > 0 && (
              <>
                <Eyebrow className="block pt-4 pb-1" style={{ fontSize: '.58rem' }}>Inativos</Eyebrow>
                {inactiveOffers.map(o => <OfferRow key={o.id} offer={o} onEdit={() => startEdit(o)} onToggle={() => handleToggle(o.id)} onDelete={() => handleDelete(o.id)} />)}
              </>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={() => setShowInactive(v => !v)} className="text-xs hover:opacity-60" style={{ color: 'var(--muted)' }}>{showInactive ? 'Ocultar inativos' : 'Mostrar inativos'}</button>
        </div>
      </div>
    </MkLayout>
  )
}

function OfferRow({ offer, onEdit, onToggle, onDelete }: { offer: PackageOffer; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const pricePerItem = offer.priceCentavos / offer.quantity
  const discount = Math.max(0, offer.quantity * 600 - offer.priceCentavos)

  return (
    <MkCard style={{ padding: 16, opacity: offer.isActive ? 1 : 0.5 }}>
      <div className="flex items-center gap-4">
        <div style={{ width: 48, height: 48, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span className="mk-display" style={{ fontWeight: 700, fontSize: '1.1rem', lineHeight: 1 }}>{offer.quantity}</span>
          <span style={{ color: 'var(--muted)', fontSize: '9px' }}>série(s)</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium" style={{ color: 'var(--ink)' }}>{offer.name}</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{offer.pricingMode === 'minimum_quantity' ? '≥' : '='} {offer.quantity}</span>
          </div>
          {offer.description && <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{offer.description}</p>}
          <div className="flex items-center gap-3 mt-1">
            <span className="font-semibold text-sm" style={{ color: '#1d7a52' }}>{formatBRL(offer.priceCentavos)}</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{formatBRL(Math.round(pricePerItem))} / item</span>
            {discount > 0 && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}>-{formatBRL(discount)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="p-2 rounded-lg hover:opacity-60" style={{ color: 'var(--muted)' }}><Pencil size={14} /></button>
          <button onClick={onToggle} className="p-2 rounded-lg hover:opacity-60">{offer.isActive ? <ToggleRight size={16} style={{ color: '#1d7a52' }} /> : <ToggleLeft size={16} style={{ color: 'var(--muted)' }} />}</button>
          <button onClick={onDelete} className="p-2 rounded-lg hover:opacity-60" style={{ color: 'var(--muted)' }}><Trash2 size={14} /></button>
        </div>
      </div>
    </MkCard>
  )
}
