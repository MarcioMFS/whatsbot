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
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import gsap from 'gsap'
import { ArrowLeft, Save, Play, Square } from 'lucide-react'
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

const nodeTypes = {
  trigger: TriggerNode,
  ai_response: AIResponseNode,
  text_message: TextNode,
  condition: ConditionNode,
  capture: CaptureNode,
  webhook: WebhookNode,
  delay: DelayNode,
  end: EndNode,
}

export function FlowBuilder() {
  const { botId, flowId } = useParams<{ botId: string; flowId: string }>()
  const navigate = useNavigate()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNode, setSelectedNode] = useState<{ id: string; type: string; data: Record<string, unknown> } | null>(null)
  const [flowName, setFlowName] = useState('Flow')
  const [saving, setSaving] = useState(false)
  const [bot, setBot] = useState<{ isActive: boolean; activeFlowId: string | null } | null>(null)
  const [activateError, setActivateError] = useState<string | null>(null)
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
    (connection: Connection) => setEdges(eds => addEdge({ ...connection, type: 'smoothstep' }, eds)),
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
      end: { label: 'End' },
    }
    setNodes(nds => [
      ...nds,
      { id, type, position: { x: 200 + Math.random() * 200, y: 200 + nds.length * 80 }, data: defaults[type] ?? { label: type } },
    ])
  }, [setNodes])

  const save = async () => {
    if (!flowId) return
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
    </div>
  )
}
