import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { X, Sparkles, Upload, ChevronDown, ChevronUp, Bot, Loader2, FileText } from 'lucide-react'
import { api } from '../../api/client.ts'
import { useUIStore } from '../../stores/uiStore.ts'

interface GeneratedConfig {
  productName: string
  persona: string
  systemPrompt: string
  welcomeMessage: string
  suggestedFlow: Array<{ type: string; description: string }>
}

interface Props {
  onClose: () => void
  onCreated: (bot: unknown) => void
}

export function CreateBotModal({ onClose, onCreated }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Step 1 state
  const [botName, setBotName] = useState('')
  const [instanceName, setInstanceName] = useState('')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState('en')
  const [provider, setProvider] = useState<'claude' | 'groq'>('groq')

  // Step 2 state
  const [generated, setGenerated] = useState<GeneratedConfig | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState('')

  // UI state
  const [step, setStep] = useState<1 | 2>(1)
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const { t } = useUIStore()

  useEffect(() => {
    gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2 })
    gsap.fromTo(modalRef.current,
      { opacity: 0, y: 30, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power3.out' }
    )
  }, [])

  const close = () => {
    gsap.to(modalRef.current, { opacity: 0, y: 20, scale: 0.96, duration: 0.25, ease: 'power2.in', onComplete: onClose })
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setDescription(prev => prev ? `${prev}\n\n${text}` : text)
    }
    reader.readAsText(file)
  }

  const generate = async () => {
    if (!description.trim()) { setError(t('describeFirst')); return }
    setError('')
    setGenerating(true)
    try {
      const config = await api.ai.generateBotConfig(description, language, provider) as GeneratedConfig
      setGenerated(config)
      setEditedPrompt(config.systemPrompt)
      if (!botName) setBotName(config.productName + ' Bot')
      setStep(2)
      setTimeout(() => {
        gsap.fromTo('.step2-content',
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }
        )
      }, 50)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const createBot = async () => {
    if (!botName || !instanceName || !generated) return
    setError('')
    setCreating(true)
    try {
      const bot = await api.bots.create({
        name: botName,
        productInfo: {
          name: generated.productName,
          description,
          persona: generated.persona,
          language,
          extraContext: '',
        },
        aiConfig: {
          provider,
          model: provider === 'claude' ? 'claude-sonnet-4-6' : 'llama-3.3-70b-versatile',
          temperature: 0.7,
          maxTokens: 1024,
          systemPromptTemplate: editedPrompt,
        },
        evolutionConfig: {
          instanceName: instanceName.toLowerCase().replace(/\s+/g, '-'),
        },
      })
      onCreated(bot)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div ref={modalRef} className="glass w-full max-w-xl max-h-[92vh] overflow-y-auto" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-glass-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
              <Bot size={16} className="text-brand-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                {step === 1 ? t('createYourBot') : t('reviewYourBot')}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {step === 1 ? t('describeProduct') : t('aiGenerated')}
              </p>
            </div>
          </div>
          <button onClick={close} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">

          {/* ─── STEP 1 ─── */}
          {step === 1 && (
            <>
              {/* Provider toggle */}
              <div className="flex gap-2">
                {(['groq', 'claude'] as const).map(p => (
                  <button key={p} onClick={() => setProvider(p)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                      provider === p
                        ? 'bg-brand-500/20 border-brand-500/40 text-brand-400'
                        : 'bg-glass-100 border-glass-border text-slate-400 hover:text-white'
                    }`}>
                    {p === 'groq' ? t('groqFaster') : '🤖 Claude'}
                  </button>
                ))}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  {t('whatDoesProductDo')}
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={5}
                  placeholder={t('descriptionPlaceholder')}
                  className="w-full bg-glass-100 border border-glass-border rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500/50 resize-none transition-all"
                />
              </div>

              {/* PDF upload */}
              <div>
                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer hover:text-white transition-colors w-fit">
                  <Upload size={14} />
                  {t('orUploadFile')}
                  <input type="file" accept=".txt,.md,.csv" onChange={handleFileUpload} className="hidden" />
                </label>
                <p className="text-xs text-slate-600 mt-1">{t('uploadNote')}</p>
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">{t('botLanguage')}</label>
                <input
                  type="text"
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  placeholder="English, Português, Español, Français..."
                  className="w-full bg-glass-100 border border-glass-border rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500/50 transition-all"
                />
              </div>

              {error && <ErrorBox msg={error} />}

              <button onClick={generate} disabled={generating || !description.trim()}
                className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all shadow-glow-sm hover:shadow-glow-md">
                {generating
                  ? <><Loader2 size={16} className="animate-spin" /> {t('generating')}</>
                  : <><Sparkles size={16} /> {t('generateWithAI')}</>}
              </button>
            </>
          )}

          {/* ─── STEP 2 ─── */}
          {step === 2 && generated && (
            <div className="step2-content space-y-5">
              {/* Bot name */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">{t('botName')}</label>
                <input type="text" value={botName} onChange={e => setBotName(e.target.value)}
                  className="w-full bg-glass-100 border border-glass-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-brand-500/50" />
              </div>

              {/* WhatsApp instance */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('whatsappInstance')}</label>
                <p className="text-xs text-slate-500 mb-2">{t('instanceNote')}</p>
                <input type="text" value={instanceName} onChange={e => setInstanceName(e.target.value)}
                  placeholder="my-store-bot"
                  className="w-full bg-glass-100 border border-glass-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-brand-500/50 font-mono" />
              </div>

              {/* AI Preview cards */}
              <div className="bg-glass-100 border border-glass-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={14} className="text-brand-400" />
                  <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">AI Generated</span>
                </div>
                <InfoRow label={t('persona')} value={generated.persona} />
                <InfoRow label={t('welcomeMessage')} value={generated.welcomeMessage} />
                <div>
                  <p className="text-xs text-slate-400 mb-1">{t('suggestedFlow')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {generated.suggestedFlow.map((s, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded-lg bg-glass-200 text-slate-300 border border-glass-border capitalize">
                        {s.type.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Advanced — editable prompt */}
              <div>
                <button onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showAdvanced ? t('hidePrompt') : t('viewEditPrompt')}
                </button>
                {showAdvanced && (
                  <textarea value={editedPrompt} onChange={e => setEditedPrompt(e.target.value)}
                    rows={8}
                    className="mt-3 w-full bg-glass-100 border border-glass-border rounded-xl px-4 py-3 text-white text-xs font-mono focus:outline-none focus:border-brand-500/50 resize-none" />
                )}
              </div>

              {/* Regenerate */}
              <button onClick={() => setStep(1)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-brand-400 transition-colors">
                <FileText size={14} />
                {t('changeDescription')}
              </button>

              {error && <ErrorBox msg={error} />}

              <button onClick={createBot} disabled={creating || !botName || !instanceName}
                className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-all shadow-glow-sm hover:shadow-glow-md">
                {creating
                  ? <><Loader2 size={16} className="animate-spin" /> {t('creatingBot')}</>
                  : <><Bot size={16} /> {t('createBot')}</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm text-white">{value}</p>
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{msg}</p>
}
