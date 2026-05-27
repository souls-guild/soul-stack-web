import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Shell } from './components/layout';
import { Login } from './pages/Login';
import { IncarnationsList } from './pages/incarnations/IncarnationsList';
import { IncarnationDetail } from './pages/incarnations/IncarnationDetail';
import { SoulsList } from './pages/souls/SoulsList';
import { SoulDetail } from './pages/souls/SoulDetail';
import { AuditLog } from './pages/audit/AuditLog';
import { ArchonsList } from './pages/archons/ArchonsList';
import { ArchonDetail } from './pages/archons/ArchonDetail';
import { PushApply } from './pages/push/PushApply';
import { ErrandExec } from './pages/errand/ErrandExec';
import { ErrandHistory } from './pages/errand/ErrandHistory';
import { RbacPage } from './pages/rbac/RbacPage';
import { ServicesList } from './pages/services/ServicesList';
import { ServiceDetail } from './pages/services/ServiceDetail';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Shell>{children}</Shell>
    </ProtectedRoute>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/incarnations" replace />} />
            <Route path="/incarnations" element={<Protected><IncarnationsList /></Protected>} />
            <Route path="/incarnations/:name" element={<Protected><IncarnationDetail /></Protected>} />
            <Route path="/souls" element={<Protected><SoulsList /></Protected>} />
            <Route path="/souls/:sid" element={<Protected><SoulDetail /></Protected>} />
            <Route path="/audit" element={<Protected><AuditLog /></Protected>} />
            <Route path="/archons" element={<Protected><ArchonsList /></Protected>} />
            <Route path="/archons/:aid" element={<Protected><ArchonDetail /></Protected>} />
            <Route path="/push" element={<Protected><PushApply /></Protected>} />
            <Route path="/errand" element={<Navigate to="/errand/exec" replace />} />
            <Route path="/errand/exec" element={<Protected><ErrandExec /></Protected>} />
            <Route path="/errand/history" element={<Protected><ErrandHistory /></Protected>} />
            <Route path="/rbac" element={<Protected><RbacPage /></Protected>} />
            <Route path="/services" element={<Protected><ServicesList /></Protected>} />
            <Route path="/services/:name" element={<Protected><ServiceDetail /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
