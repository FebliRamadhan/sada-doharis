import { useAuth } from '../hooks/useAuth';

/**
 * Tampilkan info pengguna yang sedang login.
 */
export default function UserProfile() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div
        style={{
          width: 40, height: 40, borderRadius: '50%',
          background: '#005598', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: '1rem',
        }}
      >
        {user.name.charAt(0).toUpperCase()}
      </div>

      <div>
        <div style={{ fontWeight: 600 }}>{user.name}</div>
        <div style={{ fontSize: '0.85rem', color: '#666' }}>{user.email}</div>
      </div>

      <button
        onClick={logout}
        style={{
          marginLeft: 'auto', padding: '0.4rem 0.9rem',
          border: '1px solid #ccc', borderRadius: 6,
          background: 'none', cursor: 'pointer', fontSize: '0.85rem',
        }}
      >
        Keluar
      </button>
    </div>
  );
}
