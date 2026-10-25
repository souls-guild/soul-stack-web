import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface Props {
  children: ReactNode;
}

export function ProtectedRoute({ children }: Props) {
  const { isAuthenticated, isVerifying } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    // A session being restored (one cookie exchange) is not a logout yet.
    if (isVerifying) return null;
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
