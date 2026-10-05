import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div role="status" className="grid min-h-screen place-items-center">Checking session…</div>;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
