import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import gsap from 'gsap'
import { ArrowLeft, Save, Play, Square, AlertTriangle, X, FileDown, FileUp, Copy, Check } from 'lucide-react'
import { api } from '../api/client.ts'
import { NodePalette } from '../components/flow/NodePalette.tsx'
import { NodeConfigPanel } from '../components/flow/NodeConfigPanel.tsx'
import { TriggerNode } from '../components/flow/nodes/TriggerNode.tsx'
import { AIResponseNode } from '../components/flow/nodes/AIResponseNode.tsx'
import { TextNode } from '../components/flow/nodes/TextNode.tsx'
import { ConditionNode } from '../components/flow/nodes/ConditionNode.tsx'
import { CaptureNode } from '../components/flow/nodes/CaptureNode.tsx'
import { WebhookNode } from '../components/flow/nodes/WebhookNode.tsx'
import { DelayNode } from '../components/flow/nodes/DelayNode.tsx'
import { EndNode } from '../components/flow/nodes/EndNode.tsx'
import { DistributorNode } from '../components/flow/nodes/DistributorNode.tsx'
import { NotificationNode } from '../components/flow/nodes/NotificationNode.tsx'
import { PixelNode } from '../components/flow/nodes/PixelNode.tsx'
import { PixNode } from '../components/flow/nodes/PixNode.tsx'
import { LabelNode } from '../components/flow/nodes/LabelNode.tsx'
import { CatalogSearchNode } from '../components/flow/nodes/CatalogSearchNode.tsx'
import { CartAddNode } from '../components/flow/nodes/CartAddNode.tsx'
import { CartSummaryNode } from '../components/flow/nodes/CartSummaryNode.tsx'
import { CheckoutNode } from '../components/flow/nodes/CheckoutNode.tsx'
import { PackagePixNode } from '../components/flow/nodes/PackagePixNode.tsx'
import { ClassifyIntentNode } from '../components/flow/nodes/ClassifyIntentNode.tsx'
import { DeliverTitleNode } from '../components/flow/nodes/DeliverTitleNode.tsx'
import { AiRouterNode } from '../components/flow/nodes/AiRouterNode.tsx'

function validateFlow(nodes: Node[], edges: Edge[]): string[] {
  const errors: string[] = []

  const triggers = nodes.filter(n => n.type === 'trigger')
  if (triggers.length === 0) errors.push('O fluxo precisa ter um nó Trigger.')
  else if (triggers.length > 1) errors.push('O fluxo pode ter apenas 1 nó Trigger.')
  else if (!edges.find(e => e.source === triggers[0].id))
    errors.push('O Trigger precisa estar conectado a outro nó.')

  nodes.filter(n => n.type === 'condition').forEach(n => {
    const lbl = String(n.data.label ?? 'Condição')
    if (!edges.find(e => e.source === n.id && e.sourceHandle === 'true'))
      errors.push(`"${lbl}": conecte a saída verde (true).`)
    if (!edges.find(e => e.source === n.id && e.sourceHandle === 'false'))
      errors.push(`"${lbl}": conecte a saída vermelha (false).`)
  })

  nodes.filter(n => n.type === 'capture').forEach(n => {
    const lbl = String(n.data.label ?? 'Capture')
    if (!edges.find(e => e.source === n.id))
      errors.push(`"${lbl}": saída "respondeu" não está conectada.`)
    const varName = String(n.data.variableName ?? '')
    if (!varName || !/^\w+$/.test(varName))
      errors.push(`"${lbl}": nome da variável inválido — use só letras, números e _.`)
  })

  nodes
    .filter(n => !['end', 'trigger', 'condition', 'capture'].includes(n.type ?? ''))
    .forEach(n => {
      const hasOut = edges.find(e => e.source === n.id)
      if (!hasOut)
        errors.push(`"${String(n.data.label ?? n.type)}": nó sem saída conectada.`)
    })

  return errors
}

const nodeTypes = {
  trigger: TriggerNode,
  ai_response: AIResponseNode,
  text_message: TextNode,
  condition: ConditionNode,
  capture: CaptureNode,
  webhook: WebhookNode,
  delay: DelayNode,
  distributor: DistributorNode,
  notification: NotificationNode,
  pixel: PixelNode,
  pix: PixNode,
  label: LabelNode,
  catalog_search: CatalogSearchNode,
  cart_add: CartAddNode,
  cart_summary: CartSummaryNode,
  checkout: CheckoutNode,
  package_pix: PackagePixNode,
  classify_intent: ClassifyIntentNode,
  deliver_title: DeliverTitleNode,
  ai_router: AiRouterNode,
  end: EndNode,
}

export function FlowBuilder() {
  const { botId, flowId } = useParams<{ botId: string; flowId: string }>()
  const navigate = useNavigate()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNode, setSelectedNode] = useState<{ id: string; type: string; data: Record<string, unknown> } | null>(null)
  const [flowName, setFlowName] = useState('Flow')
  const [saving, setSaving] = useState(false)
  const [bot, setBot] = useState<{ isActive: boolean; activeFlowId: string | null } | null>(null)
  const [activateError, setActivateError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [jsonPanel, setJsonPanel] = useState<'export' | 'import' | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!botId || !flowId) return
    Promise.all([
      api.bots.get(botId),
      api.flows.list(botId),
    ]).then(([botData, flows]) => {
      setBot(botData as { isActive: boolean; activeFlowId: string | null })
      const flow = (flows as Array<{ id: string; name: string; nodes: unknown[]; edges: unknown[] }>).find(f => f.id === flowId)
      if (flow) {
        setFlowName(flow.name)
        setNodes(flow.nodes as ReturnType<typeof useNodesState>[0])
        setEdges(flow.edges as ReturnType<typeof useEdgesState>[0])
      }
    })

    if (headerRef.current) {
      gsap.fromTo(headerRef.current, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' })
    }
  }, [botId, flowId])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges(eds => {
        const duplicate = eds.find(
          e => e.source === connection.source && (e.sourceHandle ?? null) === (connection.sourceHandle ?? null)
        )
        if (duplicate) return eds
        return addEdge({ ...connection, type: 'smoothstep' }, eds)
      })
    },
    [setEdges]
  )

  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => {
    setSelectedNode({ id: node.id, type: node.type ?? 'unknown', data: node.data })
  }, [])

  const updateNodeData = useCallback((nodeId: string, newData: Record<string, unknown>) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n))
    setSelectedNode(s => s?.id === nodeId ? { ...s, data: { ...s.data, ...newData } } : s)
  }, [setNodes])

  const addNode = useCallback((type: string) => {
    const id = `${type}_${Date.now()}`
    const defaults: Record<string, Record<string, unknown>> = {
      text_message: { label: 'Send Message', message: 'Hello! How can I help you?' },
      ai_response: { label: 'AI Response', promptTemplate: 'Answer the user: {{user_message}}', useHistory: true },
      condition: { label: 'Condition', variable: 'answer', operator: 'equals', value: 'yes' },
      capture: { label: 'Ask a question here...', variableName: 'user_input' },
      webhook: { label: 'Webhook', url: 'https://...', method: 'POST' },
      delay: { label: 'Wait', seconds: 2 },
      distributor: { label: 'Distribuidor', variations: ['Olá! Como posso ajudar?', 'Oi! Em que posso te ajudar?'] },
      notification: { label: 'Notificação', phoneNumber: '', message: '{{name}} ({{phone}}) entrou em contato.' },
      pixel: { label: 'Facebook Pixel', pixelId: '', accessToken: '', eventName: 'Purchase', value: '0', currency: 'BRL' },
      pix: { label: 'Botão Pix', pixKey: '', amount: '', description: '', recipientName: '' },
      label: { label: 'Etiqueta', labelName: '' },
      end: { label: 'End' },
    }
    setNodes(nds => [
      ...nds,
      { id, type, position: { x: 200 + Math.random() * 200, y: 200 + nds.length * 80 }, data: defaults[type] ?? { label: type } },
    ])
  }, [setNodes])

  const save = async () => {
    if (!flowId) return
    const errs = validateFlow(nodes, edges)
    if (errs.length > 0) { setValidationErrors(errs); return }
    setValidationErrors([])
    setSaving(true)
    try {
      await api.flows.update(flowId, { name: flowName, nodes, edges })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    if (!botId || !flowId || !bot) return
    setActivateError(null)
    if (!bot.isActive || bot.activeFlowId !== flowId) {
      const errs = validateFlow(nodes, edges)
      if (errs.length > 0) { setValidationErrors(errs); return }
      setValidationErrors([])
    }
    try {
      if (bot.isActive && bot.activeFlowId === flowId) {
        const updated = await api.bots.deactivate(botId)
        setBot(updated as { isActive: boolean; activeFlowId: string | null })
      } else {
        const updated = await api.bots.activate(botId, flowId)
        setBot(updated as { isActive: boolean; activeFlowId: string | null })
      }
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : 'Failed to activate flow')
      setTimeout(() => setActivateError(null), 5000)
    }
  }

  const isActive = bot?.isActive && bot?.activeFlowId === flowId

  const openExport = () => {
    const payload = { name: flowName, nodes, edges }
    setJsonText(JSON.stringify(payload, null, 2))
    setJsonPanel('export')
    setCopied(false)
  }

  const openImport = () => {
    setJsonText('')
    setImportError(null)
    setJsonPanel('import')
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleImport = () => {
    setImportError(null)
    try {
      const parsed = JSON.parse(jsonText)
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        setImportError('JSON inválido — precisa ter "nodes" e "edges".')
        return
      }
      if (parsed.nodes.length > 200) {
        setImportError(`Fluxo muito grande (${parsed.nodes.length} nós). Máximo recomendado: 200.`)
        return
      }
      if (parsed.name) setFlowName(parsed.name)
      setNodes(parsed.nodes)
      setEdges(parsed.edges)
      setJsonPanel(null)
    } catch {
      setImportError('JSON inválido — verifique a sintaxe.')
    }
  }

  return (
    <div className="h-screen flex flex-col bg-[#020617]">
      {/* Header */}
      <div ref={headerRef} className="flex items-center gap-4 px-4 py-3 border-b border-glass-border glass" style={{ borderRadius: 0, zIndex: 10 }}>
        <button onClick={() => navigate(`/bots/${botId}/config`)} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <input
          value={flowName}
          onChange={e => setFlowName(e.target.value)}
          className="bg-transparent text-white font-semibold focus:outline-none border-b border-transparent focus:border-brand-500/50 transition-colors"
        />
        <div className="flex-1" />
        {activateError && (
          <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg max-w-xs truncate">
            {activateError}
          </span>
        )}
        <button
          onClick={openExport}
          title="Export JSON"
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-glass-100 hover:bg-glass-200 border border-glass-border px-3 py-2 rounded-xl transition-all"
        >
          <FileDown size={14} /> Export
        </button>
        <button
          onClick={openImport}
          title="Import JSON"
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-glass-100 hover:bg-glass-200 border border-glass-border px-3 py-2 rounded-xl transition-all"
        >
          <FileUp size={14} /> Import
        </button>
        <button
          onClick={toggleActive}
          className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-all duration-200 ${
            isActive
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
              : 'bg-glass-200 text-slate-300 border border-glass-border hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30'
          }`}
        >
          {isActive ? <><Square size={14} /> Deactivate</> : <><Play size={14} /> Activate</>}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-all shadow-glow-sm"
        >
          <Save size={14} />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {validationErrors.length > 0 && (
        <div className="mx-4 my-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex gap-3 items-start">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-0.5">
            {validationErrors.map((e, i) => (
              <p key={i} className="text-xs text-red-300">{e}</p>
            ))}
          </div>
          <button onClick={() => setValidationErrors([])} className="text-slate-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Node Palette */}
        <NodePalette onAdd={addNode} />

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(148,163,184,0.1)" />
            <Controls />
            <MiniMap nodeColor={() => 'rgba(14,165,233,0.4)'} maskColor="rgba(2,6,23,0.7)" />
          </ReactFlow>
        </div>

        {/* Node Config Panel */}
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onUpdate={updateNodeData}
            onClose={() => setSelectedNode(null)}
            nodes={nodes}
          />
        )}
      </div>

      {/* JSON Drawer */}
      {jsonPanel && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col glass border-t border-glass-border"
          style={{ height: '42vh' }}>
          {/* Drawer header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-glass-border shrink-0">
            {jsonPanel === 'export' ? (
              <FileDown size={15} className="text-brand-400" />
            ) : (
              <FileUp size={15} className="text-emerald-400" />
            )}
            <span className="text-sm font-semibold text-white">
              {jsonPanel === 'export'
                ? `Export JSON — ${nodes.length} nós, ${edges.length} edges`
                : 'Import JSON — cole o conteúdo abaixo'}
            </span>
            <div className="flex-1" />
            {jsonPanel === 'export' && (
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-glass-200 text-slate-300 border-glass-border hover:text-white'
                }`}
              >
                {copied ? <><Check size={12} /> Copiado!</> : <><Copy size={12} /> Copiar</>}
              </button>
            )}
            {jsonPanel === 'import' && (
              <button
                onClick={handleImport}
                className="flex items-center gap-1.5 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-all"
              >
                <FileUp size={12} /> Carregar fluxo
              </button>
            )}
            <button onClick={() => setJsonPanel(null)} className="text-slate-400 hover:text-white ml-1">
              <X size={16} />
            </button>
          </div>

          {/* Error */}
          {importError && (
            <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 shrink-0">
              {importError}
            </div>
          )}

          {/* Textarea */}
          <textarea
            value={jsonText}
            onChange={e => { if (jsonPanel === 'import') { setJsonText(e.target.value); setImportError(null) } }}
            readOnly={jsonPanel === 'export'}
            spellCheck={false}
            placeholder={jsonPanel === 'import' ? '{ "name": "...", "nodes": [...], "edges": [...] }' : ''}
            className="flex-1 w-full bg-transparent text-slate-300 text-xs font-mono px-4 py-3 resize-none focus:outline-none"
            style={{ lineHeight: '1.6' }}
          />
        </div>
      )}
    </div>
  )
}
