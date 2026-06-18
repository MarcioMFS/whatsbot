import { useEffect, useState } from 'react'
import { Sparkles, Check, X, Loader2, Inbox, Stethoscope, Workflow } from 'lucide-react'
import { MkButton, Eyebrow, InfoTip } from '../mkhub'
import { api, type FlowProposal } from '../../api/client.ts'

// Builder/Improver — fila de propostas da IA (gate humano). A IA propõe (free, NVIDIA), você aprova/rejeita.
export function ProposalsPanel({ botId, activeFlowId }: { botId: string; activeFlowId: string | null }) {
  const [proposals, setProposals] = useState<FlowProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showFlowGen, setShowFlowGen] = useState(false)
  const [bizDesc, setBizDesc] = useState('')

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
  const generateFlow = async () => {
    setBusy('generate_flow'); setMsg(null)
    try {
      await api.proposals.generateFlow(botId, bizDesc.trim())
      setMsg({ kind: 'ok', text: 'A IA montou um fluxo de vendas completo — revise e aprove abaixo. Ele entra inativo.' })
      setShowFlowGen(false); setBizDesc('')
      await load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'falha ao gerar fluxo' }) }
    finally { setBusy(null) }
  }
  const improve = async () => {
    setBusy('improve'); setMsg(null)
    try {
      const r = await api.proposals.improve(botId)
      if (r && 'proposal' in r && r.proposal === null) setMsg({ kind: 'ok', text: r.reason ?? 'Sem sugestões no momento.' })
      else setMsg({ kind: 'ok', text: 'A IA analisou os sinais reais e propôs melhorias — veja abaixo.' })
      await load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'falha ao sugerir' }) }
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
        <div className="flex items-center gap-2">
          <MkButton variant="ghost" onClick={improve} disabled={busy === 'improve'}>
            {busy === 'improve' ? <Loader2 size={14} className="animate-spin" /> : <Stethoscope size={14} />}
            Sugerir melhorias
          </MkButton>
          <MkButton variant="ghost" onClick={() => setShowFlowGen(v => !v)} disabled={busy === 'generate_flow'}>
            {busy === 'generate_flow' ? <Loader2 size={14} className="animate-spin" /> : <Workflow size={14} />}
            Gerar fluxo
          </MkButton>
          <MkButton onClick={generate} disabled={busy === 'generate' || !activeFlowId}>
            {busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Gerar habilidades
          </MkButton>
        </div>
      </div>

      {showFlowGen && (
        <div className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Descreva o negócio</div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>A IA monta um fluxo de vendas completo (catálogo → carrinho → PIX → comprovante → entrega) com a copy do seu negócio. A estrutura é garantida — você revisa e aprova. O fluxo entra <strong>inativo</strong>.</p>
          <textarea
            value={bizDesc}
            onChange={e => setBizDesc(e.target.value)}
            rows={4}
            placeholder="Ex.: Vendo minisséries (doramas dublados) a R$6 cada, pacote de 3 por R$13. Pagamento via PIX, entrego o link de acesso na hora."
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
          />
          <div className="flex justify-end gap-2">
            <MkButton variant="ghost" onClick={() => { setShowFlowGen(false); setBizDesc('') }} disabled={busy === 'generate_flow'}>Cancelar</MkButton>
            <MkButton onClick={generateFlow} disabled={busy === 'generate_flow'}>
              {busy === 'generate_flow' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Gerar fluxo
            </MkButton>
          </div>
        </div>
      )}

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
  const suggestions = (p.proposedContent?.suggestions as Array<{ title?: string; problem?: string; recommendation?: string }> | undefined) ?? []
  const summary = typeof p.proposedContent?.summary === 'string' ? p.proposedContent.summary : ''
  const flowGen = p.kind === 'generate_flow'
    ? (p.proposedContent as { name?: string; nodeCount?: number; nodes?: Array<{ id?: string; data?: { label?: string; message?: string } }> } | undefined)
    : undefined
  // Roteiro do funil: todas as mensagens visíveis, na ordem dos nós — pra revisar ANTES de ativar.
  const flowScript = (flowGen?.nodes ?? []).filter(n => typeof n.data?.message === 'string' && n.data!.message!.trim())
  const isPending = p.status === 'pending'
  const applicable = p.kind === 'generate_segments' || p.kind === 'generate_flow' // aplicam ao aprovar; resto é advisory

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
            {applicable ? (
              <>
                <MkButton variant="ghost" onClick={onReject} disabled={busy}><X size={14} /> Rejeitar</MkButton>
                <MkButton onClick={onApprove} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Aprovar</MkButton>
              </>
            ) : (
              <MkButton variant="ghost" onClick={onReject} disabled={busy}><X size={14} /> Dispensar</MkButton>
            )}
          </div>
        )}
      </div>

      {flowGen && (
        <div className="space-y-2">
          <div className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {flowGen.name ?? 'Funil de vendas'}
              <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}> · {flowGen.nodeCount ?? 0} nós · catálogo → carrinho → PIX → entrega</span>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Ao aprovar, o fluxo é criado <strong>inativo</strong> — leia as mensagens abaixo e ative quando fizer sentido.</div>
          </div>
          {flowScript.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Mensagens do funil (na ordem que o cliente recebe):</div>
              {flowScript.map((n, i) => (
                <div key={i} className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}>
                  <div className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{i + 1}. {n.data?.label ?? n.id}</div>
                  <div className="text-xs mt-0.5 whitespace-pre-line" style={{ color: 'var(--ink-soft)' }}>{n.data?.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

      {summary && <p className="text-sm mb-2" style={{ color: 'var(--ink-soft)' }}>{summary}</p>}
      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          {suggestions.map((s, i) => (
            <div key={i} className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{s.title}</div>
              {s.problem && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Problema: {s.problem}</div>}
              {s.recommendation && <div className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>→ {s.recommendation}</div>}
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
