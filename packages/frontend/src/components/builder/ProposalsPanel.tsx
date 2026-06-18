import { useEffect, useState } from 'react'
import { Sparkles, Check, X, Loader2, Inbox } from 'lucide-react'
import { MkButton, Eyebrow, InfoTip } from '../mkhub'
import { api, type FlowProposal } from '../../api/client.ts'

// Builder/Improver — fila de propostas da IA (gate humano). A IA propõe (free, NVIDIA), você aprova/rejeita.
export function ProposalsPanel({ botId, activeFlowId }: { botId: string; activeFlowId: string | null }) {
  const [proposals, setProposals] = useState<FlowProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = async () => {
    setLoading(true)
    try { setProposals((await api.proposals.list(botId)).proposals) }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'erro ao carregar' }) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [botId])

  const generate = async () => {
    if (!activeFlowId) { setMsg({ kind: 'err', text: 'Bot sem flow ativo para gerar.' }); return }
    setBusy('generate'); setMsg(null)
    try {
      await api.proposals.generate(botId, activeFlowId, 'generate_segments')
      setMsg({ kind: 'ok', text: 'A IA gerou uma proposta — revise e aprove abaixo.' })
      await load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'falha na geração' }) }
    finally { setBusy(null) }
  }
  const approve = async (id: string) => {
    setBusy(id); setMsg(null)
    try { const r = await api.proposals.approve(id); setMsg({ kind: 'ok', text: `Aprovada e aplicada (${r.applied ?? 'ok'}, snapshot v${r.snapshotVersion ?? '?'}).` }); await load() }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'falha ao aprovar' }) }
    finally { setBusy(null) }
  }
  const reject = async (id: string) => {
    setBusy(id); setMsg(null)
    try { await api.proposals.reject(id); await load() }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'falha ao rejeitar' }) }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Eyebrow>Propostas da IA</Eyebrow>
          <InfoTip text={<>A IA <strong>propõe</strong> melhorias (de graça, modelo NVIDIA); nada é aplicado sem você <strong>aprovar</strong>. Ao aprovar, um snapshot do flow é salvo antes (rollback).</>} />
        </div>
        <MkButton onClick={generate} disabled={busy === 'generate' || !activeFlowId}>
          {busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Gerar com IA
        </MkButton>
      </div>

      {msg && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)', color: msg.kind === 'err' ? '#b42318' : 'var(--ink)' }}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}><Loader2 size={14} className="animate-spin" /> carregando…</div>
      ) : proposals.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10" style={{ color: 'var(--muted)' }}>
          <Inbox size={28} strokeWidth={1.4} />
          <p className="text-sm">Nenhuma proposta ainda. Clique em <strong>Gerar com IA</strong> para a IA propor habilidades do flow ativo.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map(p => (
            <ProposalCard key={p.id} p={p} busy={busy === p.id} onApprove={() => approve(p.id)} onReject={() => reject(p.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending:  { bg: '#fef3c7', fg: '#92400e', label: 'pendente' },
  applied:  { bg: '#dcfce7', fg: '#166534', label: 'aplicada' },
  approved: { bg: '#dcfce7', fg: '#166534', label: 'aprovada' },
  rejected: { bg: '#f1f1f1', fg: '#6b7280', label: 'rejeitada' },
  stale:    { bg: '#fee2e2', fg: '#b42318', label: 'obsoleta' },
}

function ProposalCard({ p, busy, onApprove, onReject }: { p: FlowProposal; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const st = STATUS_STYLE[p.status] ?? { bg: '#f1f1f1', fg: '#6b7280', label: p.status }
  const segments = (p.proposedContent?.segments as Array<{ name?: string; description?: string; whenToUse?: string; nodeIds?: string[] }> | undefined) ?? []
  const isPending = p.status === 'pending'

  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{labelForKind(p.kind)}</span>
          <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>· {p.createdBy === 'ai' ? 'gerada pela IA' : 'manual'} · {new Date(p.createdAt).toLocaleString('pt-BR')}</span>
        </div>
        {isPending && (
          <div className="flex items-center gap-2">
            <MkButton variant="ghost" onClick={onReject} disabled={busy}><X size={14} /> Rejeitar</MkButton>
            <MkButton onClick={onApprove} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Aprovar</MkButton>
          </div>
        )}
      </div>

      {segments.length > 0 && (
        <div className="space-y-1.5">
          {segments.map((s, i) => (
            <div key={i} className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{s.name} <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>· {s.nodeIds?.length ?? 0} nós</span></div>
              {s.description && <div className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>{s.description}</div>}
              {s.whenToUse && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Quando usar: {s.whenToUse}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function labelForKind(kind: string): string {
  const map: Record<string, string> = {
    generate_segments: 'Habilidades do flow (segmentos)',
    improve_copy: 'Melhoria de copy',
    add_capability: 'Nova capability',
    generate_flow: 'Flow novo',
  }
  return map[kind] ?? kind
}
