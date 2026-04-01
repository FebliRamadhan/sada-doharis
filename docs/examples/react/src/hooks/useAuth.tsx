/**
 * SADA SSO — React Auth Context & Hook
 *
 * Wrap aplikasi Anda dengan <AuthProvider> lalu gunakan
 * hook useAuth() di komponen mana pun.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  loadTokens,
  clearTokens,
  fetchUserInfo,
  redirectToLogin,
  logout as ssoLogout,
  getValidAccessToken,
  type UserInfo,
  type TokenSet,
} from '../lib/sso';

// ─── Context ──────────────────────────────────────────────────────────────────

interface AuthState {
  /** Pengguna yang sedang login, null jika belum login */
  user:      UserInfo | null;
  /** Token set aktif */
  tokens:    TokenSet | null;
  /** true saat sedang memeriksa status login */
  loading:   boolean;
  /** Mulai login — redirect ke SADA SSO */
  login:     () => Promise<void>;
  /** Logout — hapus token + redirect ke SADA SSO end session */
  logout:    () => void;
  /** Ambil access token yang valid (auto-refresh jika perlu) */
  getToken:  () => Promise<string | null>;
  /** true jika pengguna sudah login */
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<UserInfo | null>(null);
  const [tokens,  setTokens]  = useState<TokenSet | null>(null);
  const [loading, setLoading] = useState(true);

  // Cek token tersimpan saat app pertama load
  useEffect(() => {
    (async () => {
      const stored = loadTokens();
      if (!stored) { setLoading(false); return; }

      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) { setLoading(false); return; }

        const userInfo = await fetchUserInfo(accessToken);
        setTokens(stored);
        setUser(userInfo);
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(() => redirectToLogin(), []);

  const logoutFn = useCallback(() => {
    ssoLogout(window.location.origin + '/login');
    setUser(null);
    setTokens(null);
  }, []);

  const getToken = useCallback(() => getValidAccessToken(), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        loading,
        login,
        logout: logoutFn,
        getToken,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}

/**
 * Dipakai oleh komponen yang melakukan API call.
 * Otomatis menyertakan Authorization header.
 *
 * @example
 * const apiFetch = useApiFetch();
 * const data = await apiFetch('/api/data');
 */
export function useApiFetch() {
  const { getToken } = useAuth();

  return useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const token = await getToken();

      return fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    [getToken],
  );
}
