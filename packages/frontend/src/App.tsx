import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore.ts'
import { Dashboard } from './pages/Dashboard.tsx'
import { BotConfig } from './pages/BotConfig.tsx'
import { FlowBuilder } from './pages/FlowBuilder.tsx'
import { Leads } from './pages/Leads.tsx'
import { Events } from './pages/Events.tsx'
import { Products } from './pages/Products.tsx'
import { Orders } from './pages/Orders.tsx'
import { PackageOffers } from './pages/PackageOffers.tsx'
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
      <Route path="/bots/:botId/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
      <Route path="/bots/:botId/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
      <Route path="/bots/:botId/package-offers" element={<ProtectedRoute><PackageOffers /></ProtectedRoute>} />
    </Routes>
  )
}
