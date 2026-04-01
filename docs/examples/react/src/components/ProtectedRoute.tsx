import { type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';

interface Props {
  children: ReactNode;
  /** Komponen fallback saat belum login (default: redirect otomatis) */
  fallback?: ReactNode;
}

/**
 * Lindungi route dari pengguna yang belum login.
 *
 * @example
 * <ProtectedRoute>
 *   <DashboardPage />
 * </ProtectedRoute>
 */
export default function ProtectedRoute({ children, fallback }: Props) {
  const { isAuthenticated, loading, login } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <span>Memuat...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (fallback) return <>{fallback}</>;
    // Auto-redirect ke SADA SSO
    login();
    return null;
  }

  return <>{children}</>;
}
