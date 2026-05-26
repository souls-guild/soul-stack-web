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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
