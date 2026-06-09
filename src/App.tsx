import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Shell } from './components/layout';
import { Login } from './pages/Login';
import { IncarnationsList } from './pages/incarnations/IncarnationsList';
import { IncarnationDetail } from './pages/incarnations/IncarnationDetail';
import { IncarnationNewForm } from './pages/incarnations/IncarnationNewForm';
import { SoulsList } from './pages/souls/SoulsList';
import { SoulDetail } from './pages/souls/SoulDetail';
import { AuditLog } from './pages/audit/AuditLog';
import { ArchonsList } from './pages/archons/ArchonsList';
import { ArchonDetail } from './pages/archons/ArchonDetail';
import { PushApply } from './pages/push/PushApply';
import { ErrandsList } from './pages/errands/ErrandsList';
import { ErrandNewForm } from './pages/errands/ErrandNewForm';
import { ErrandDetail } from './pages/errands/ErrandDetail';
import { RbacPage } from './pages/rbac/RbacPage';
import { ServicesList } from './pages/services/ServicesList';
import { ServiceDetail } from './pages/services/ServiceDetail';
import { PluginsList } from './pages/plugins/PluginsList';
import { PluginDetail } from './pages/plugins/PluginDetail';
import { PluginRegisterForm } from './pages/plugins/PluginRegisterForm';
import { VigilsList } from './pages/beacons/VigilsList';
import { VigilDetail } from './pages/beacons/VigilDetail';
import { VigilNewForm } from './pages/beacons/VigilNewForm';
import { DecreesList } from './pages/beacons/DecreesList';
import { DecreeDetail } from './pages/beacons/DecreeDetail';
import { DecreeNewForm } from './pages/beacons/DecreeNewForm';
import { OracleFiresList } from './pages/beacons/OracleFiresList';
import { PushRunsList } from './pages/pushRuns/PushRunsList';
import { PushRunDetail } from './pages/pushRuns/PushRunDetail';
import { RunWizard } from './pages/run/RunWizard';
import { RunsFeed } from './pages/runs/RunsFeed';
import { VoyageDetail } from './pages/voyages/VoyageDetail';
import { CadencesList } from './pages/cadences/CadencesList';
import { CadenceDetail } from './pages/cadences/CadenceDetail';
import { SynodsList } from './pages/synods/SynodsList';
import { SynodDetail } from './pages/synods/SynodDetail';

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

// Default landing — `/runs` (unified feed), с возможностью запомнить иной маршрут
// в localStorage('landing'). Валидируем сохранённое значение (только known-маршрут),
// иначе fallback на /runs.
const KNOWN_LANDINGS = new Set(['/runs', '/incarnations', '/run', '/souls']);
function landingTarget(): string {
  try {
    const saved = localStorage.getItem('landing');
    if (saved && KNOWN_LANDINGS.has(saved)) return saved;
  } catch {
    // localStorage недоступен — дефолт.
  }
  return '/runs';
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to={landingTarget()} replace />} />
            <Route path="/incarnations" element={<Protected><IncarnationsList /></Protected>} />
            <Route path="/incarnations/new" element={<Protected><IncarnationNewForm /></Protected>} />
            <Route path="/incarnations/:name" element={<Protected><IncarnationDetail /></Protected>} />
            <Route path="/souls" element={<Protected><SoulsList /></Protected>} />
            <Route path="/souls/:sid" element={<Protected><SoulDetail /></Protected>} />
            <Route path="/audit" element={<Protected><AuditLog /></Protected>} />
            <Route path="/archons" element={<Protected><ArchonsList /></Protected>} />
            <Route path="/archons/:aid" element={<Protected><ArchonDetail /></Protected>} />
            <Route path="/push" element={<Protected><PushApply /></Protected>} />
            <Route path="/errands" element={<Protected><ErrandsList /></Protected>} />
            <Route path="/errands/new" element={<Protected><ErrandNewForm /></Protected>} />
            <Route path="/errands/:id" element={<Protected><ErrandDetail /></Protected>} />
            <Route path="/errand" element={<Navigate to="/errands" replace />} />
            <Route path="/errand/exec" element={<Navigate to="/errands/new" replace />} />
            <Route path="/errand/history" element={<Navigate to="/errands" replace />} />
            <Route path="/rbac" element={<Protected><RbacPage /></Protected>} />
            <Route path="/services" element={<Protected><ServicesList /></Protected>} />
            <Route path="/services/:name" element={<Protected><ServiceDetail /></Protected>} />
            <Route path="/plugins" element={<Protected><PluginsList /></Protected>} />
            <Route path="/plugins/register" element={<Protected><PluginRegisterForm /></Protected>} />
            <Route path="/plugins/:namespace/:name/:ref" element={<Protected><PluginDetail /></Protected>} />
            <Route path="/vigils" element={<Protected><VigilsList /></Protected>} />
            <Route path="/vigils/new" element={<Protected><VigilNewForm /></Protected>} />
            <Route path="/vigils/:name" element={<Protected><VigilDetail /></Protected>} />
            <Route path="/decrees" element={<Protected><DecreesList /></Protected>} />
            <Route path="/decrees/new" element={<Protected><DecreeNewForm /></Protected>} />
            <Route path="/decrees/:name" element={<Protected><DecreeDetail /></Protected>} />
            <Route path="/oracle/fires" element={<Protected><OracleFiresList /></Protected>} />
            <Route path="/push-runs" element={<Protected><PushRunsList /></Protected>} />
            <Route path="/push-runs/:applyId" element={<Protected><PushRunDetail /></Protected>} />
            <Route path="/run" element={<Protected><RunWizard /></Protected>} />
            <Route path="/runs" element={<Protected><RunsFeed /></Protected>} />
            <Route path="/voyages/:id" element={<Protected><VoyageDetail /></Protected>} />
            <Route path="/cadences" element={<Protected><CadencesList /></Protected>} />
            <Route path="/cadences/:id" element={<Protected><CadenceDetail /></Protected>} />
            <Route path="/synods" element={<Protected><SynodsList /></Protected>} />
            <Route path="/synods/:name" element={<Protected><SynodDetail /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
