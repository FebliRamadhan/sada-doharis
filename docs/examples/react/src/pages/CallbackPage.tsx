import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleCallback, exchangeCode, fetchUserInfo } from '../lib/sso';

/**
 * Halaman callback OAuth2.
 * Daftarkan sebagai route /callback.
 *
 * Alur:
 *  1. Baca ?code=&state= dari URL
 *  2. Verifikasi state (anti-CSRF)
 *  3. Tukar code → token
 *  4. Ambil profil user
 *  5. Redirect ke halaman utama
 */
export default function CallbackPage() {
  const navigate  = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Langkah 2: Baca & validasi callback params
        const { code } = handleCallback();

        // Langkah 3: Tukar code dengan token
        const tokens = await exchangeCode(code);

        // Langkah 4: Ambil profil (opsional — bisa juga pakai id_token)
        await fetchUserInfo(tokens.access_token);

        // Langkah 5: Redirect
        const returnPath = sessionStorage.getItem('sso_return_path') ?? '/dashboard';
        sessionStorage.removeItem('sso_return_path');
        navigate(returnPath, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
      }
    })();
  }, [navigate]);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: '#c0392b' }}>Login Gagal</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/login')}>Coba Lagi</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>Memproses login...</p>
    </div>
  );
}
