import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import CallbackPage from './pages/CallbackPage';
import ProtectedRoute from './components/ProtectedRoute';
import UserProfile from './components/UserProfile';
import { useAuth } from './hooks/useAuth';

function LoginPage() {
  const { login, loading } = useAuth();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem' }}>
      <h1>Selamat Datang</h1>
      <p>Silakan login menggunakan akun PANRB Anda.</p>
      <button
        onClick={login}
        disabled={loading}
        style={{
          padding: '0.8rem 2rem', background: '#005598', color: '#fff',
          border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '1rem',
        }}
      >
        Login dengan SADA SSO
      </button>
    </div>
  );
}

function DashboardPage() {
  const { user } = useAuth();
  return (
    <div style={{ padding: '2rem' }}>
      <UserProfile />
      <hr style={{ margin: '2rem 0' }} />
      <h2>Dashboard</h2>
      <p>Selamat datang, <strong>{user?.name}</strong>!</p>
      <p>Email: {user?.email}</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/callback" element={<CallbackPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
