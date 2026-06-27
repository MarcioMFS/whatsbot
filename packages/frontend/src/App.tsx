import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore.ts'
import { Dashboard } from './pages/Dashboard.tsx'
import { BotConfig } from './pages/BotConfig.tsx'
import { FlowBuilder } from './pages/FlowBuilder.tsx'
import { Leads } from './pages/Leads.tsx'
import { Events } from './pages/Events.tsx'
import { AgentTrace } from './pages/AgentTrace.tsx'
import { Products } from './pages/Products.tsx'
import { Orders } from './pages/Orders.tsx'
import { PackageOffers } from './pages/PackageOffers.tsx'
import { Handoffs } from './pages/Handoffs.tsx'
import PaymentIntents from './pages/PaymentIntents.tsx'
import { Capabilities } from './pages/Capabilities.tsx'
import { AIPatterns } from './pages/AIPatterns.tsx'
import { Login } from './pages/Login.tsx'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/bots/:botId/config" element={<ProtectedRoute><BotConfig /></ProtectedRoute>} />
      <Route path="/bots/:botId/flow/:flowId" element={<ProtectedRoute><FlowBuilder /></ProtectedRoute>} />
      <Route path="/bots/:botId/leads" element={<ProtectedRoute><Leads /></ProtectedRoute>} />
      <Route path="/bots/:botId/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
      <Route path="/bots/:botId/agent-trace" element={<ProtectedRoute><AgentTrace /></ProtectedRoute>} />
      <Route path="/bots/:botId/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
      <Route path="/bots/:botId/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
      <Route path="/bots/:botId/package-offers" element={<ProtectedRoute><PackageOffers /></ProtectedRoute>} />
      <Route path="/bots/:botId/handoffs" element={<ProtectedRoute><Handoffs /></ProtectedRoute>} />
      <Route path="/bots/:botId/payment-intents" element={<ProtectedRoute><PaymentIntents /></ProtectedRoute>} />
      <Route path="/bots/:botId/capabilities" element={<ProtectedRoute><Capabilities /></ProtectedRoute>} />
      <Route path="/bots/:botId/patterns" element={<ProtectedRoute><AIPatterns /></ProtectedRoute>} />
    </Routes>
  )
}
