import { useState } from 'react'
import {
  CreditCard, LifeBuoy, Package, RotateCcw, Search, Image as ImageIcon,
  ShoppingBag, HelpCircle, Plus, ArrowRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────────
// Prototype of the "orchestrator-home" in the MKHUB editorial language
// (monochrome paper, ink, Sora/Inter, soft cards, black stripe accent).
// Standalone preview — mocked DramaHub data, no backend.
// ──────────────────────────────────────────────────────────────────────────────

type ModuleKind = 'roteável' | 'efeito' | 'ferramenta'

interface ModuleItem {
  id: string
  name: string
  kind: ModuleKind
  desc: string
  icon: LucideIcon
  on: boolean
}

const INITIAL_MODULES: ModuleItem[] = [
  { id: 'pix', name: 'Pagamento PIX', kind: 'roteável', desc: 'Gera o PIX, valida o comprovante e confirma — com as regras de fraude embutidas.', icon: CreditCard, on: true },
  { id: 'human', name: 'Falar com humano', kind: 'roteável', desc: 'Reclamação ou fraude → avisa você e pausa o bot.', icon: LifeBuoy, on: true },
  { id: 'delivery', name: 'Entrega do acesso', kind: 'efeito', desc: 'Assim que o pagamento confirma, entrega o link da série.', icon: Package, on: true },
  { id: 'recover', name: 'Recuperar cliente', kind: 'efeito', desc: 'Cliente sumiu no meio? O bot reengaja sozinho.', icon: RotateCcw, on: true },
  { id: 'catalog', name: 'Catálogo & busca', kind: 'ferramenta', desc: '324 títulos, 7 pacotes. Busca por nome, mesmo escrito errado.', icon: Search, on: true },
  { id: 'media', name: 'Imagem & áudio', kind: 'ferramenta', desc: 'Cliente manda print da série ou áudio? O bot entende.', icon: ImageIcon, on: true },
]

const HABILIDADES = [
  { id: 'sell', name: 'Vender série', icon: ShoppingBag, examples: ['quero', 'vou levar', 'tem a Cavaleiros do Sol?', 'quero 3'], uses: 'Catálogo → Pagamento' },
  { id: 'faq', name: 'Dúvidas frequentes', icon: HelpCircle, examples: ['como funciona?', 'é seguro?', 'tem legenda?'], uses: 'responde na hora' },
]

export function OrchestratorPreview() {
  const [modules, setModules] = useState(INITIAL_MODULES)
  const toggle = (id: string) =>
    setModules(ms => ms.map(m => (m.id === id ? { ...m, on: !m.on } : m)))

  return (
    <div className="mkhub-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');
        .mkhub-root{
          --ink:#0a0a0a; --ink-soft:#2a2a2a; --muted:#6b6b6b;
          --line:rgba(10,10,10,0.1); --paper:#f6f6f4; --paper-2:#fff;
          min-height:100vh; background:var(--paper); color:var(--ink);
          font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased;
          padding:64px 32px 120px; position:relative; overflow:hidden;
        }
        .mkhub-root .display{ font-family:'Sora',system-ui,sans-serif; }
        .mkhub-root .eyebrow{ letter-spacing:.32em; text-transform:uppercase; font-size:.7rem; font-weight:600; color:var(--muted); }
        .mkhub-root .tagline{ font-family:'Sora'; letter-spacing:.42em; font-weight:600; text-transform:uppercase; }
        .mkhub-card{
          background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(255,255,255,.74));
          border:1px solid var(--line); border-radius:22px; backdrop-filter:blur(14px);
          box-shadow:0 30px 80px -32px rgba(10,10,10,.22);
          transition:transform .45s cubic-bezier(.16,1,.3,1), box-shadow .45s ease;
        }
        .mkhub-card:hover{ transform:translateY(-8px); box-shadow:0 44px 100px -34px rgba(10,10,10,.32); }
        .mkhub-sculpt{
          position:absolute; border-radius:50%;
          background:radial-gradient(circle at 30% 30%,#fff,#e7e7e3 60%,#d6d6d0);
          box-shadow:0 24px 60px -20px rgba(10,10,10,.16), inset 0 2px 30px rgba(255,255,255,.9);
          pointer-events:none;
        }
        .mkhub-switch{ width:46px; height:26px; border-radius:999px; padding:3px; cursor:pointer; transition:background .3s ease; border:1px solid var(--line); }
        .mkhub-switch .knob{ width:20px; height:20px; border-radius:50%; background:var(--paper-2); transition:transform .3s cubic-bezier(.16,1,.3,1); box-shadow:0 2px 6px rgba(10,10,10,.25); }
      `}</style>

      {/* sculptural accents */}
      <div className="mkhub-sculpt" style={{ width: 320, height: 320, top: -120, right: -80, opacity: .7 }} />
      <div className="mkhub-sculpt" style={{ width: 160, height: 160, bottom: 80, left: -60, opacity: .5 }} />

      <div style={{ maxWidth: 1080, margin: '0 auto', position: 'relative' }}>
        {/* Wordmark */}
        <div className="flex items-center justify-between mb-20">
          <div className="display" style={{ fontWeight: 700, letterSpacing: '.18em', fontSize: '1.05rem' }}>
            DRAMAHUB
          </div>
          <div className="eyebrow">Inteligência do bot</div>
        </div>

        {/* Hero */}
        <div className="mb-16" style={{ maxWidth: 720 }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="stripe" style={{ width: 40, height: 3, background: 'var(--ink)' }} />
            <span className="eyebrow">Orquestrador</span>
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(2.4rem,5vw,3.6rem)', fontWeight: 700, lineHeight: 1.04, letterSpacing: '-0.02em' }}>
            Seu bot, organizado<br />por dentro.
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '1.05rem', lineHeight: 1.6, marginTop: 24, maxWidth: 540 }}>
            A cada mensagem, a IA lê o contexto e escolhe o que fazer. Você liga os
            <strong style={{ color: 'var(--ink)', fontWeight: 600 }}> módulos prontos</strong> e descreve as
            <strong style={{ color: 'var(--ink)', fontWeight: 600 }}> habilidades</strong> do seu negócio. Sem desenhar fluxograma.
          </p>
        </div>

        {/* How it routes — editorial strip */}
        <div className="mkhub-card flex items-center gap-5 mb-24" style={{ padding: '22px 28px' }}>
          <span style={{ fontFamily: 'Sora', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '.98rem' }}>
            "tem a série Cavaleiros do Sol?"
          </span>
          <ArrowRight size={16} strokeWidth={1.5} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <span className="eyebrow" style={{ flexShrink: 0 }}>orquestrador lê</span>
          <ArrowRight size={16} strokeWidth={1.5} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--ink)', color: 'var(--paper)', padding: '8px 16px', borderRadius: 999, fontSize: '.85rem', fontWeight: 600, flexShrink: 0 }}>
            <ShoppingBag size={14} strokeWidth={1.8} /> Vender série
          </span>
        </div>

        {/* MÓDULOS */}
        <SectionLabel n="01" title="Módulos" hint="Prontos — ligar e configurar" />
        <div className="grid gap-4 mb-24" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' }}>
          {modules.map(m => {
            const Icon = m.icon
            return (
              <div key={m.id} className="mkhub-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, opacity: m.on ? 1 : 0.55 }}>
                <div className="flex items-start justify-between">
                  <div style={{ width: 44, height: 44, borderRadius: 14, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-2)' }}>
                    <Icon size={19} strokeWidth={1.6} />
                  </div>
                  <button onClick={() => toggle(m.id)}
                    className="mkhub-switch"
                    style={{ background: m.on ? 'var(--ink)' : 'transparent', display: 'flex', justifyContent: m.on ? 'flex-end' : 'flex-start' }}
                    aria-label="ligar/desligar">
                    <div className="knob" />
                  </button>
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="display" style={{ fontSize: '1.08rem', fontWeight: 600 }}>{m.name}</h3>
                  </div>
                  <span className="eyebrow" style={{ fontSize: '.6rem' }}>{m.kind}</span>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: '.9rem', lineHeight: 1.5, flex: 1 }}>{m.desc}</p>
                <button style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.82rem', fontWeight: 600, color: 'var(--ink)', borderBottom: '1.5px solid var(--ink)', paddingBottom: 1 }}>
                  Configurar <ArrowRight size={13} strokeWidth={2} />
                </button>
              </div>
            )
          })}
        </div>

        {/* HABILIDADES */}
        <SectionLabel n="02" title="Habilidades" hint="Suas — o que o bot fala e vende" />
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' }}>
          {HABILIDADES.map(h => {
            const Icon = h.icon
            return (
              <div key={h.id} className="mkhub-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="flex items-center gap-3">
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={19} strokeWidth={1.6} />
                  </div>
                  <h3 className="display" style={{ fontSize: '1.15rem', fontWeight: 600 }}>{h.name}</h3>
                </div>
                <div>
                  <span className="eyebrow" style={{ fontSize: '.6rem' }}>Quando o cliente diz</span>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {h.examples.map(ex => (
                      <span key={ex} style={{ fontSize: '.82rem', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 999, padding: '5px 12px', background: 'var(--paper-2)' }}>
                        "{ex}"
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>→ {h.uses}</span>
                  <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.82rem', fontWeight: 600, color: 'var(--ink)', borderBottom: '1.5px solid var(--ink)', paddingBottom: 1 }}>
                    Editar <ArrowRight size={13} strokeWidth={2} />
                  </button>
                </div>
              </div>
            )
          })}

          {/* New habilidade */}
          <button style={{ borderRadius: 22, border: '1.5px dashed var(--line)', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--muted)', minHeight: 180, background: 'transparent' }}>
            <Plus size={22} strokeWidth={1.5} />
            <span className="display" style={{ fontSize: '.95rem', fontWeight: 600, color: 'var(--ink-soft)' }}>Nova habilidade</span>
            <span style={{ fontSize: '.78rem' }}>descreva e a IA roteia</span>
          </button>
        </div>

        {/* Persona footer */}
        <div className="flex items-center gap-3 mt-20" style={{ color: 'var(--muted)' }}>
          <div className="stripe" style={{ width: 28, height: 3, background: 'var(--ink)' }} />
          <span style={{ fontSize: '.88rem' }}>
            Persona: <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>Bia</strong> · tom acolhedor · DramaHub
          </span>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ n, title, hint }: { n: string; title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-7">
      <span className="display" style={{ fontSize: '.85rem', color: 'var(--muted)', fontWeight: 600 }}>{n}</span>
      <h2 className="display" style={{ fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h2>
      <span className="eyebrow" style={{ marginLeft: 'auto' }}>{hint}</span>
    </div>
  )
}
