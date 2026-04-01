# SADA SSO — Panduan Integrasi Frontend

Panduan ini menjelaskan cara mengintegrasikan aplikasi frontend Anda dengan SADA SSO menggunakan OAuth2 Authorization Code + PKCE.

---

## Alur Integrasi

```
Aplikasi Anda              SADA Auth UI          SADA Auth Service
     │                         │                        │
     │  1. Klik "Login"         │                        │
     │ ─────────────────────── ▶│                        │
     │   redirect ke /authorize │                        │
     │                         │  2. Tampilkan form login│
     │                         │◀ ─────────────────────  │
     │                         │                        │
     │                         │  3. User input kredensial
     │                         │  (LDAP / email / SSO)  │
     │                         │ ──────────────────────▶│
     │                         │  POST /auth/login      │
     │                         │                        │
     │                         │  4. Login sukses       │
     │                         │◀ ─────────────────────  │
     │                         │                        │
     │                         │  5. User klik "Izinkan"│
     │                         │  GET /oauth/authorize  │
     │                         │   + Bearer token       │
     │                         │ ──────────────────────▶│
     │                         │                        │
     │  6. Redirect ke callback │  authorization_code    │
     │◀ ─────────────────────── │ ◀──────────────────── │
     │  ?code=xxx&state=yyy    │                        │
     │                         │                        │
     │  7. POST /oauth/token    │                        │
     │  (code + code_verifier)  │                        │
     │ ─────────────────────────────────────────────── ▶│
     │                         │                        │
     │  8. Terima token         │                        │
     │  { access_token,         │                        │
     │    refresh_token,        │                        │
     │    id_token }            │                        │
     │◀ ─────────────────────────────────────────────── │
     │                         │                        │
     │  9. GET /oauth/userinfo  │                        │
     │  Authorization: Bearer   │                        │
     │ ─────────────────────────────────────────────── ▶│
     │                         │                        │
     │  10. { sub, name, email }│                        │
     │◀ ─────────────────────────────────────────────── │
```

---

## Langkah-langkah Integrasi

### Prasyarat

1. Hubungi admin SADA SSO untuk mendapatkan:
   - `client_id`
   - `client_secret`
   - Daftarkan `redirect_uri` aplikasi Anda

2. Atau buat sendiri via API (jika memiliki akses admin):

```bash
# Buat OAuth client baru
curl -s -X POST http://localhost:3001/clients \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Nama Aplikasi Anda",
    "redirectUris": ["http://localhost:5173/callback"],
    "scopes": ["openid","profile","email","offline_access"],
    "grants": ["authorization_code","refresh_token"]
  }' | python3 -m json.tool

# Catat: id (UUID) dan clientId (hex) dari response
# Generate secret
curl -X POST http://localhost:3001/clients/{id}/regenerate-secret
```

---

### Endpoint Penting

| Endpoint | URL | Keterangan |
|----------|-----|------------|
| Login UI | `http://localhost:3002/authorize` | Halaman consent SSO |
| Token | `http://localhost:3001/oauth/token` | Exchange code & refresh |
| UserInfo | `http://localhost:3001/oauth/userinfo` | Profil pengguna |
| JWKS | `http://localhost:3001/.well-known/jwks.json` | Public key untuk verifikasi JWT |
| Discovery | `http://localhost:3001/oauth/.well-known/openid-configuration` | Semua endpoint |
| Logout | `http://localhost:3001/oauth/logout` | End session |

---

### Scope yang Tersedia

| Scope | Data yang Diberikan |
|-------|---------------------|
| `openid` | `sub` (user ID) |
| `profile` | `name`, `preferred_username` |
| `email` | `email`, `email_verified` |
| `offline_access` | `refresh_token` |
| `internal` | Akses khusus pegawai PANRB |

---

## Integrasi React

### Instalasi

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install react-router-dom
```

### File yang Perlu Disalin

```
src/
  lib/sso.ts              ← Shared OAuth utilities
  hooks/useAuth.tsx       ← Auth context + hook
  components/
    ProtectedRoute.tsx    ← Guard untuk halaman private
    UserProfile.tsx       ← Tampilkan info user
  pages/
    CallbackPage.tsx      ← Handle redirect callback
```

### Setup

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
);

// src/App.tsx — wrap dengan AuthProvider
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import CallbackPage from './pages/CallbackPage';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/callback" element={<CallbackPage />} />
          <Route path="/dashboard" element={
            <ProtectedRoute><DashboardPage /></ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

### Penggunaan di Komponen

```tsx
import { useAuth, useApiFetch } from './hooks/useAuth';

function MyComponent() {
  const { user, login, logout, isAuthenticated } = useAuth();
  const apiFetch = useApiFetch(); // fetch dengan token otomatis

  const loadData = async () => {
    const res  = await apiFetch('http://localhost:3001/auth/me');
    const data = await res.json();
    console.log(data);
  };

  if (!isAuthenticated) {
    return <button onClick={login}>Login dengan SSO</button>;
  }

  return (
    <div>
      <p>Halo, {user?.name}!</p>
      <button onClick={loadData}>Ambil Data</button>
      <button onClick={logout}>Keluar</button>
    </div>
  );
}
```

### .env

```env
VITE_SSO_CLIENT_ID=cf00cae4d6135051875ce6990bf2e5ea
VITE_SSO_CLIENT_SECRET=isi_client_secret
VITE_SSO_REDIRECT_URI=http://localhost:5173/callback
VITE_SSO_AUTHORIZE_URL=http://localhost:3002/authorize
VITE_SSO_TOKEN_URL=http://localhost:3001/oauth/token
VITE_SSO_USERINFO_URL=http://localhost:3001/oauth/userinfo
VITE_SSO_LOGOUT_URL=http://localhost:3001/oauth/logout
```

---

## Integrasi Svelte (SvelteKit)

### Instalasi

```bash
npm create svelte@latest my-app
cd my-app
npm install
```

### File yang Perlu Disalin

```
src/
  lib/
    sso.ts           ← Shared OAuth utilities
    auth.store.ts    ← Svelte store
  components/
    ProtectedRoute.svelte
    UserProfile.svelte
  routes/
    +layout.svelte   ← Init auth di sini
    callback/
      +page.svelte   ← Handle redirect callback
    dashboard/
      +page.svelte   ← Contoh halaman terproteksi
```

### Setup

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { initAuth } from '$lib/auth.store';
  onMount(() => initAuth());
</script>
<slot />
```

### Penggunaan di Komponen

```svelte
<script lang="ts">
  import { user, isAuthenticated, login, logout, authFetch } from '$lib/auth.store';

  async function loadData() {
    const res  = await authFetch('http://localhost:3001/auth/me');
    const data = await res.json();
    console.log(data);
  }
</script>

{#if $isAuthenticated}
  <p>Halo, {$user?.name}!</p>
  <button on:click={loadData}>Ambil Data</button>
  <button on:click={logout}>Keluar</button>
{:else}
  <button on:click={login}>Login dengan SSO</button>
{/if}
```

### .env

```env
PUBLIC_SSO_CLIENT_ID=cf00cae4d6135051875ce6990bf2e5ea
PUBLIC_SSO_CLIENT_SECRET=isi_client_secret
PUBLIC_SSO_REDIRECT_URI=http://localhost:5173/callback
PUBLIC_SSO_AUTHORIZE_URL=http://localhost:3002/authorize
PUBLIC_SSO_TOKEN_URL=http://localhost:3001/oauth/token
PUBLIC_SSO_USERINFO_URL=http://localhost:3001/oauth/userinfo
PUBLIC_SSO_LOGOUT_URL=http://localhost:3001/oauth/logout
```

> **Catatan Svelte:** Ganti `import.meta.env.VITE_*` di `sso.ts` menjadi `import.meta.env.PUBLIC_*` untuk SvelteKit.

---

## Integrasi Framework Lain

Prinsipnya sama. Yang dibutuhkan:

1. **Redirect ke SADA SSO** dengan parameter PKCE
2. **Handle callback** — baca `?code=` dan verifikasi `state`
3. **Exchange code** — `POST /oauth/token` dengan `code_verifier`
4. **Simpan token** — localStorage/sessionStorage/cookie
5. **Sertakan token** di setiap API request: `Authorization: Bearer <token>`
6. **Refresh otomatis** sebelum token kedaluwarsa

Fungsi utama yang sama dipakai semua framework ada di `src/lib/sso.ts`.

---

## Verifikasi Token (Server-side)

Jika backend Anda perlu memverifikasi token secara mandiri:

```bash
# Ambil public key
curl http://localhost:3001/.well-known/jwks.json

# Atau introspect langsung
curl -X POST http://localhost:3001/oauth/introspect \
  -H 'Content-Type: application/json' \
  -d '{
    "token": "ACCESS_TOKEN",
    "client_id": "CLIENT_ID",
    "client_secret": "CLIENT_SECRET"
  }'
# Response: { "active": true, "sub": "...", "scope": "...", "exp": ... }
```

Token menggunakan **RS256**. Verifikasi menggunakan public key dari JWKS endpoint.

---

## Troubleshooting

| Error | Penyebab | Solusi |
|-------|----------|--------|
| `INVALID_CLIENT` | client_id/secret salah | Pastikan nilai dari admin SSO |
| `State mismatch` | sessionStorage terhapus | Jangan buka tab baru saat login |
| `invalid_grant` | code sudah dipakai / kedaluwarsa | Mulai flow dari awal |
| `Token inactive` setelah introspect | Token sudah direvoke | Request token baru |
| Redirect loop | redirect_uri tidak terdaftar | Daftarkan exact URI ke admin SSO |
