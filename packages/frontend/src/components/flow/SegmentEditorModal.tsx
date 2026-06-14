import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, BackgroundVariant,
  type Connection, type Edge, type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X, Save, Loader2, Link2 } from 'lucide-react'
import { api, type FlowSegment } from '../../api/client.ts'
import { NodePalette } from './NodePalette.tsx'
import { NodeConfigPanel } from './NodeConfigPanel.tsx'
import { TriggerNode } from './nodes/TriggerNode.tsx'
import { AIResponseNode } from './nodes/AIResponseNode.tsx'
import { TextNode } from './nodes/TextNode.tsx'
import { ConditionNode } from './nodes/ConditionNode.tsx'
import { CaptureNode } from './nodes/CaptureNode.tsx'
import { WebhookNode } from './nodes/WebhookNode.tsx'
import { DelayNode } from './nodes/DelayNode.tsx'
import { EndNode } from './nodes/EndNode.tsx'
import { DistributorNode } from './nodes/DistributorNode.tsx'
import { NotificationNode } from './nodes/NotificationNode.tsx'
import { PixelNode } from './nodes/PixelNode.tsx'
import { PixNode } from './nodes/PixNode.tsx'
import { LabelNode } from './nodes/LabelNode.tsx'
import { CatalogSearchNode } from './nodes/CatalogSearchNode.tsx'
import { CartAddNode } from './nodes/CartAddNode.tsx'
import { CartSummaryNode } from './nodes/CartSummaryNode.tsx'
import { CheckoutNode } from './nodes/CheckoutNode.tsx'
import { PackagePixNode } from './nodes/PackagePixNode.tsx'
import { ClassifyIntentNode } from './nodes/ClassifyIntentNode.tsx'
import { DeliverTitleNode } from './nodes/DeliverTitleNode.tsx'
import { AiRouterNode } from './nodes/AiRouterNode.tsx'

const nodeTypes = {
  trigger: TriggerNode, ai_response: AIResponseNode, text_message: TextNode,
  condition: ConditionNode, capture: CaptureNode, webhook: WebhookNode, delay: DelayNode,
  distributor: DistributorNode, notification: NotificationNode, pixel: PixelNode, pix: PixNode,
  label: LabelNode, catalog_search: CatalogSearchNode, cart_add: CartAddNode,
  cart_summary: CartSummaryNode, checkout: CheckoutNode, package_pix: PackagePixNode,
  classify_intent: ClassifyIntentNode, deliver_title: DeliverTitleNode, ai_router: AiRouterNode,
  end: EndNode,
}

const NODE_DEFAULTS: Record<string, Record<string, unknown>> = {
  text_message: { label: 'Enviar Mensagem', message: 'Olá! Como posso ajudar?' },
  ai_response: { label: 'Resposta IA', promptTemplate: 'Responda: {{user_message}}', useHistory: true },
  condition: { label: 'Condição', variable: 'answer', operator: 'equals', value: 'sim' },
  capture: { label: 'Aguardar resposta…', variableName: 'user_input' },
  delay: { label: 'Aguardar', seconds: 2 },
  notification: { label: 'Notificação', phoneNumber: '', message: '{{name}} ({{phone}}) entrou em contato.' },
  end: { label: 'Fim' },
}

interface FlowNodeLike { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
interface FlowEdgeLike { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

interface Props {
  flowId: string
  flowName: string
  fullNodes: FlowNodeLike[]
  fullEdges: FlowEdgeLike[]
  segment: FlowSegment
  allSegments: FlowSegment[]
  onClose: () => void
  onSaved: (result: { segments: FlowSegment[]; nodes: FlowNodeLike[]; edges: FlowEdgeLike[] }) => void
}

// Editor com ESCOPO numa parte (segmento): mostra só os nós da parte, edita isolado,
// e faz merge de volta no fluxo completo (outras partes intocadas, conexões com o resto preservadas).
// Ver Brain/spec_skills_segmentos.md.
export function SegmentEditorModal({ flowId, flowName, fullNodes, fullEdges, segment, allSegments, onClose, onSaved }: Props) {
  const scope = useMemo(() => new Set(segment.nodeIds), [segment.nodeIds])

  const initialNodes = useMemo(
    () => fullNodes.filter(n => scope.has(n.id)) as unknown as Node[],
    [fullNodes, scope]
  )
  // Edges internas à parte (ambas as pontas no escopo). targetHandle zerado p/ a linha aparecer (ReactFlow descarta handle não-resolvido).
  const initialEdges = useMemo(
    () => fullEdges.filter(e => scope.has(e.source) && scope.has(e.target))
      .map(e => ({ ...e, targetHandle: null, type: 'smoothstep', animated: true })) as unknown as Edge[],
    [fullEdges, scope]
  )
  // Conexões com OUTRAS partes (uma ponta fora) — preservadas no save, mostradas como aviso.
  const boundaryCount = useMemo(
    () => fullEdges.filter(e => scope.has(e.source) !== scope.has(e.target)).length,
    [fullEdges, scope]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [selectedNode, setSelectedNode] = useState<{ id: string; type: string; data: Record<string, unknown> } | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const onConnect = useCallback((c: Connection) => {
    setEdges(eds => {
      if (eds.find(e => e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))) return eds
      return addEdge({ ...c, type: 'smoothstep', animated: true }, eds)
    })
  }, [setEdges])

  const onNodeClick = useCallback((_: React.MouseEvent, n: { id: string; type?: string; data: Record<string, unknown> }) => {
    setSelectedNode({ id: n.id, type: n.type ?? 'unknown', data: n.data })
  }, [])

  const updateNodeData = useCallback((id: string, data: Record<string, unknown>) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n))
    setSelectedNode(s => s?.id === id ? { ...s, data: { ...s.data, ...data } } : s)
  }, [setNodes])

  const addNode = useCallback((type: string) => {
    const id = `${type}_${Date.now()}`
    setNodes(nds => {
      const anchor = nds.reduce<Node | undefined>((a, n) => (!a || n.position.x > a.position.x ? n : a), undefined)
      const position = anchor ? { x: anchor.position.x + 280, y: anchor.position.y } : { x: 80, y: 96 }
      return [...nds, { id, type, position, data: NODE_DEFAULTS[type] ?? { label: type } } as Node]
    })
  }, [setNodes])

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const editorIds = nodes.map(n => n.id)
      // Merge de volta: tudo FORA da parte permanece; a parte é substituída pelo que está no editor.
      const keptNodes = fullNodes.filter(n => !scope.has(n.id))
      const newNodes = [...keptNodes, ...(nodes as unknown as FlowNodeLike[])]
      // Edges: descarta as internas-à-parte antigas (serão repostas pelo editor); mantém fronteira + outras partes.
      const keptEdges = fullEdges.filter(e => !(scope.has(e.source) && scope.has(e.target)))
      const validIds = new Set(newNodes.map(n => n.id))
      const newEdges = [...keptEdges, ...(edges as unknown as FlowEdgeLike[])]
        .filter(e => validIds.has(e.source) && validIds.has(e.target)) // limpa pontas órfãs de nós removidos

      await api.flows.update(flowId, { name: flowName, nodes: newNodes, edges: newEdges })
      const updatedSegments = allSegments.map(s => s.id === segment.id ? { ...s, nodeIds: editorIds, generated: false } : s)
      await api.flows.saveSegments(flowId, updatedSegments)
      onSaved({ segments: updatedSegments, nodes: newNodes, edges: newEdges })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao salvar a parte')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,11,15,0.6)', backdropFilter: 'blur(2px)' }}>
      <div className="flex flex-col rounded-2xl overflow-hidden" style={{ width: '94vw', height: '90vh', background: '#0f1115', border: '1px solid #23262e' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid #23262e', background: '#13151b' }}>
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: '#7c8190' }}>Editando a parte</p>
            <h2 className="text-base font-semibold truncate" style={{ color: '#eef0f4' }}>{segment.name || 'Sem nome'}</h2>
          </div>
          {boundaryCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg" style={{ color: '#b7935a', background: 'rgba(183,147,90,0.12)', border: '1px solid rgba(183,147,90,0.25)' }}>
              <Link2 size={12} /> {boundaryCount} {boundaryCount === 1 ? 'conexão' : 'conexões'} com outras partes (preservadas)
            </span>
          )}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg"
            style={{ background: '#eef0f4', color: '#0f1115' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar parte
          </button>
          <button onClick={onClose} style={{ color: '#7c8190' }} className="hover:opacity-70 p-1"><X size={18} /></button>
        </div>

        {err && <div className="px-5 py-2 text-xs" style={{ color: '#e0a04a', background: 'rgba(224,160,74,0.08)' }}>{err}</div>}

        {/* Body: palette + canvas + config */}
        <div className="flex flex-1 min-h-0">
          <div style={{ width: 200, borderRight: '1px solid #23262e', overflowY: 'auto', background: '#13151b' }}>
            <NodePalette onAdd={addNode} />
          </div>
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
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#23262e" />
              <Controls />
              <MiniMap pannable zoomable style={{ background: '#13151b' }} maskColor="rgba(0,0,0,0.5)" />
            </ReactFlow>
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm" style={{ color: '#7c8190' }}>Parte vazia — use a paleta à esquerda pra adicionar nós.</p>
              </div>
            )}
          </div>
          {selectedNode && (
            <div style={{ width: 360, borderLeft: '1px solid #23262e', overflowY: 'auto', background: '#13151b' }}>
              <NodeConfigPanel node={selectedNode} onUpdate={updateNodeData} onClose={() => setSelectedNode(null)} nodes={nodes} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
