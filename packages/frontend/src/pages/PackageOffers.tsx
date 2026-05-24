import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Tag, Pencil, Trash2, ToggleLeft, ToggleRight, Save, X } from 'lucide-react'
import { Layout } from '../components/ui/Layout'
import { api } from '../api/client'

interface PackageOffer {
  id: string
  name: string
  description?: string
  type: 'quantity_bundle' | 'fixed_bundle'
  pricingMode: 'exact_quantity' | 'minimum_quantity'
  quantity: number
  priceCentavos: number
  isActive: boolean
}

const emptyForm = {
  name: '',
  description: '',
  type: 'quantity_bundle' as const,
  pricingMode: 'minimum_quantity' as const,
  quantity: '',
  priceCentavos: '',
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
    try {
      const data = await api.packageOffers.list(botId, showInactive)
      setOffers(data as PackageOffer[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [botId, showInactive])

  const resetForm = () => { setForm(emptyForm); setEditing(null) }

  const startEdit = (o: PackageOffer) => {
    setEditing(o.id)
    setForm({
      name: o.name,
      description: o.description ?? '',
      type: o.type,
      pricingMode: o.pricingMode,
      quantity: String(o.quantity),
      priceCentavos: (o.priceCentavos / 100).toFixed(2).replace('.', ','),
    })
  }

  const handleSave = async () => {
    if (!botId || !form.name || !form.quantity || !form.priceCentavos) return
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        pricingMode: form.pricingMode,
        quantity: parseInt(form.quantity, 10),
        priceCentavos: parsePriceToCentavos(form.priceCentavos),
      }
      if (editing) {
        await api.packageOffers.update(editing, payload)
      } else {
        await api.packageOffers.create(botId, payload)
      }
      resetForm()
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (id: string) => {
    await api.packageOffers.toggle(id)
    await load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este pacote?')) return
    await api.packageOffers.delete(id)
    await load()
  }

  const activeOffers = offers.filter(o => o.isActive)
  const inactiveOffers = offers.filter(o => !o.isActive)

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate(`/bots/${botId}/config`)}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Tag size={22} className="text-orange-400" />
              Pacotes / Ofertas
            </h1>
            <p className="text-white/40 text-sm mt-0.5">
              Regras de preço aplicadas ao carrinho — não substituem produtos
            </p>
          </div>
        </div>

        {/* Architecture note */}
        <div className="mb-6 p-4 rounded-xl border border-orange-500/20 bg-orange-500/5 text-orange-200/80 text-sm">
          <strong className="text-orange-300">Arquitetura:</strong> Produto → Carrinho → <strong>PricingService → Pacote</strong> → Checkout.
          O pacote apenas altera o preço final. Produto permanece responsável pelo catálogo, entrega e analytics.
        </div>

        {/* Create / Edit form */}
        <div className="mb-8 p-5 rounded-2xl border border-white/10 bg-white/5">
          <h2 className="text-white font-semibold mb-4">{editing ? 'Editar Pacote' : 'Novo Pacote'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <input
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Nome do pacote (ex: 3 séries)"
              className="col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-orange-400/50 text-sm"
            />
            <input
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Descrição (opcional)"
              className="col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-orange-400/50 text-sm"
            />
            <div>
              <label className="text-white/50 text-xs mb-1 block">Quantidade de itens</label>
              <input
                type="number" min="1" value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="ex: 3"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-orange-400/50 text-sm"
              />
            </div>
            <div>
              <label className="text-white/50 text-xs mb-1 block">Preço do pacote (R$)</label>
              <input
                value={form.priceCentavos} onChange={e => setForm(f => ({ ...f, priceCentavos: e.target.value }))}
                placeholder="ex: 13,00"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-orange-400/50 text-sm"
              />
            </div>
            <div>
              <label className="text-white/50 text-xs mb-1 block">Modo de precificação</label>
              <select value={form.pricingMode} onChange={e => setForm(f => ({ ...f, pricingMode: e.target.value as 'exact_quantity' | 'minimum_quantity' }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-orange-400/50 text-sm">
                <option value="minimum_quantity">Quantidade mínima (≥ N itens)</option>
                <option value="exact_quantity">Quantidade exata (= N itens)</option>
              </select>
            </div>
            <div>
              <label className="text-white/50 text-xs mb-1 block">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'quantity_bundle' }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-orange-400/50 text-sm">
                <option value="quantity_bundle">Pacote por quantidade</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name || !form.quantity || !form.priceCentavos}
              className="flex items-center gap-2 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-300 text-sm font-medium px-4 py-2 rounded-xl transition-all disabled:opacity-40">
              <Save size={14} />
              {saving ? 'Salvando...' : editing ? 'Atualizar' : 'Criar Pacote'}
            </button>
            {editing && (
              <button onClick={resetForm}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-sm px-4 py-2 rounded-xl transition-all">
                <X size={14} /> Cancelar
              </button>
            )}
          </div>
        </div>

        {/* Offers list */}
        {loading ? (
          <div className="text-white/40 text-center py-12">Carregando...</div>
        ) : offers.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <Tag size={40} className="mx-auto mb-3 opacity-30" />
            <p>Nenhum pacote criado ainda.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Active */}
            {activeOffers.map(offer => (
              <OfferRow key={offer.id} offer={offer}
                onEdit={() => startEdit(offer)}
                onToggle={() => handleToggle(offer.id)}
                onDelete={() => handleDelete(offer.id)} />
            ))}
            {/* Inactive */}
            {showInactive && inactiveOffers.length > 0 && (
              <>
                <p className="text-white/30 text-xs pt-4 pb-1">Inativos</p>
                {inactiveOffers.map(offer => (
                  <OfferRow key={offer.id} offer={offer}
                    onEdit={() => startEdit(offer)}
                    onToggle={() => handleToggle(offer.id)}
                    onDelete={() => handleDelete(offer.id)} />
                ))}
              </>
            )}
          </div>
        )}

        {/* Toggle inactive visibility */}
        <div className="mt-6 flex justify-end">
          <button onClick={() => setShowInactive(v => !v)}
            className="text-white/30 hover:text-white/60 text-xs transition-all">
            {showInactive ? 'Ocultar inativos' : 'Mostrar inativos'}
          </button>
        </div>
      </div>
    </Layout>
  )
}

function OfferRow({ offer, onEdit, onToggle, onDelete }: {
  offer: PackageOffer
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const pricePerItem = offer.priceCentavos / offer.quantity
  const regularPrice = offer.quantity * 600 // R$6 base
  const discount = Math.max(0, regularPrice - offer.priceCentavos)

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
      offer.isActive
        ? 'bg-white/5 border-white/10 hover:border-white/20'
        : 'bg-white/2 border-white/5 opacity-50'
    }`}>
      {/* Quantity badge */}
      <div className="w-12 h-12 rounded-xl bg-orange-500/20 border border-orange-500/20 flex flex-col items-center justify-center flex-shrink-0">
        <span className="text-orange-300 font-bold text-lg leading-none">{offer.quantity}</span>
        <span className="text-orange-300/60 text-[9px]">série(s)</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium">{offer.name}</span>
          <span className="text-white/30 text-xs">{offer.pricingMode === 'minimum_quantity' ? '≥' : '='} {offer.quantity}</span>
        </div>
        {offer.description && <p className="text-white/40 text-xs mt-0.5">{offer.description}</p>}
        <div className="flex items-center gap-3 mt-1">
          <span className="text-green-400 font-semibold text-sm">{formatBRL(offer.priceCentavos)}</span>
          <span className="text-white/30 text-xs">{formatBRL(Math.round(pricePerItem))} / item</span>
          {discount > 0 && (
            <span className="text-orange-400 text-xs bg-orange-500/10 px-1.5 py-0.5 rounded">
              -{formatBRL(discount)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button onClick={onEdit} className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all">
          <Pencil size={14} />
        </button>
        <button onClick={onToggle} className="p-2 rounded-lg hover:bg-white/10 transition-all">
          {offer.isActive
            ? <ToggleRight size={16} className="text-green-400" />
            : <ToggleLeft size={16} className="text-white/30" />
          }
        </button>
        <button onClick={onDelete} className="p-2 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-all">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
