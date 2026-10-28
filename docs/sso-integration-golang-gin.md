# SADA SSO — Alur Integrasi Golang (Gin) + Nuxt

Panduan singkat integrasi SSO untuk aplikasi dengan **backend Go (Gin)** dan **frontend Nuxt**.
Fokus pada alur dan endpoint; detail implementasi (penyimpanan sesi, error handling) disesuaikan dengan aplikasi masing-masing.

---

## Arsitektur

- **Gin = BFF (Backend-for-Frontend)** sekaligus OAuth2 *confidential client*. Gin yang memegang `client_secret`, menjalankan flow OAuth, dan menyimpan token di sesi server.
- **Nuxt tidak pernah memegang token.** Browser hanya membawa cookie sesi `HttpOnly` milik Gin.
- **Flow:** Authorization Code + PKCE (S256) + `client_secret`.

| SADA SSO | `https://auth.menpan.go.id` (`SSO_BASE_URL`) |

---

## Alur

```
Browser/Nuxt              Gin BFF                SADA SSO 
    │                            │                                  │
    │ 1. klik "Login"            │                                  │
    │───────────────────────────▶│ GET /auth/login                  │
    │                            │ buat state, nonce, code_verifier │
    │                            │ simpan di sesi                   │
    │◀─ 302 ─────────────────────│                                  │
    │ 2. GET /authorize?response_type=code&client_id&redirect_uri   │
    │       &scope&state&nonce&code_challenge&code_challenge_method │
    │──────────────────────────────────────────────────────────────▶│
    │                            │   3. login (LDAP / SPLP) + MFA,  │
    │                            │      user klik "Izinkan"         │
    │◀─ 302 https://api.x.go.id/auth/callback?code=..&state=.. ─────│
    │───────────────────────────▶│ 4. GET /auth/callback            │
    │                            │    cek state == sesi             │
    │                            │ 5. POST /oauth/token ───────────▶│
    │                            │◀── access_token, refresh_token,  │
    │                            │    id_token                      │
    │                            │ 6. verifikasi id_token (JWKS)    │
    │                            │ 7. GET /oauth/userinfo ─────────▶│
    │                            │◀── profil user                   │
    │                            │ 8. simpan user+token di sesi,    │
    │                            │    set cookie Domain=.x.go.id    │
    │◀─ 302 https://app.x.go.id ─│                                  │
    │                            │                                  │
    │ 9. GET /auth/me (cookie)   │                                  │
    │───────────────────────────▶│ baca user dari sesi              │
    │◀── { user } ───────────────│                                  │
    │                            │                                  │
    │                            │ 10. token expired → POST         │
    │                            │     /oauth/token (refresh_token)▶│
    │                            │                                  │
    │ 11. klik "Logout"          │                                  │
    │───────────────────────────▶│ GET /auth/logout → hapus sesi    │
    │◀─ 302 /oauth/logout?id_token_hint&post_logout_redirect_uri ───│
    │──────────────────────────────────────────────────────────────▶│
    │◀─ 302 https://app.x.go.id ────────────────────────────────────│
```

---

## Endpoint

### Endpoint SADA SSO yang dipakai

| # | Endpoint | Dipanggil oleh | Keterangan |
|---|----------|----------------|------------|
| 2 | `GET {SSO_BASE_URL}/authorize` | Browser (redirect) | Halaman login + consent (auth-ui) |
| 5, 10 | `POST {SSO_BASE_URL}/oauth/token` | Gin | Tukar `code` → token; refresh token |
| 6 | `GET {SSO_BASE_URL}/.well-known/jwks.json` | Gin | Public key RS256 untuk verifikasi `id_token` |
| 7 | `GET {SSO_BASE_URL}/oauth/userinfo` | Gin | Profil user (`Authorization: Bearer`) |
| 11 | `GET {SSO_BASE_URL}/oauth/logout` | Browser (redirect) | *Single sign-out* global |

### Endpoint yang dibuat di Gin

| Endpoint | Fungsi |
|----------|--------|
| `GET /auth/login` | Mulai flow, redirect ke SSO |
| `GET /auth/callback` | Terima `code`, tukar token, buat sesi (**ini `redirect_uri` yang didaftarkan**) |
| `GET /auth/me` | Kembalikan user dari sesi (401 jika belum login) |
| `GET /auth/logout` | Hapus sesi, redirect ke logout SSO |

### Parameter penting

**`/authorize`**

| Parameter | Nilai |
|-----------|-------|
| `response_type` | `code` |
| `client_id` | dari admin SSO |
| `redirect_uri` | `https://api.x.go.id/auth/callback` (harus sama persis dengan yang didaftarkan) |
| `scope` | `openid profile email offline_access` (+ `pegawai` bila butuh NIP/jabatan/unit kerja) |
| `state` | random, disimpan di sesi |
| `nonce` | random, disimpan di sesi |
| `code_challenge` / `code_challenge_method` | PKCE, `S256` |

**`/oauth/token`** — body `application/x-www-form-urlencoded`:

- Tukar code: `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `client_id`, `client_secret`
- Refresh: `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`

**`/oauth/logout`** — query: `id_token_hint`, `post_logout_redirect_uri`.

---

## Hal yang Perlu Diperhatikan

1. **`client_id` & `client_secret` dikirim di body**, bukan header Basic. Di `golang.org/x/oauth2` set `AuthStyle: oauth2.AuthStyleInParams`.
2. **Jangan ambil `authorization_endpoint` dari discovery.** Nilainya `/oauth/authorize` (API internal yang butuh Bearer), bukan halaman login. Pakai `{SSO_BASE_URL}/authorize` secara eksplisit — karena itu `oidc.NewProvider` (discovery) tidak dipakai.
3. **Issuer** untuk verifikasi `id_token` = nilai `OIDC_ISSUER` server SSO (minta ke admin SSO), bukan dari discovery.
4. **Cookie sesi** (Nuxt & Gin beda subdomain): `Domain=.x.go.id; HttpOnly; Secure; SameSite=Lax`.
5. **CORS di Gin**: `AllowOrigins: https://app.x.go.id`, `AllowCredentials: true`. Nuxt wajib memakai `credentials: 'include'`.
6. **Logout bersifat global**: memanggil `/oauth/logout` dengan `id_token_hint` mencabut *semua* token & sesi SSO user tersebut, di semua aplikasi.
7. **MFA** ditangani sepenuhnya oleh halaman SSO; aplikasi tidak perlu melakukan apa-apa.

---

## Contoh Kode Minimal

### Konfigurasi (Gin)

```go
import (
    "github.com/coreos/go-oidc/v3/oidc"
    "golang.org/x/oauth2"
)

var ssoBase = os.Getenv("SSO_BASE_URL") // https://sso.x.go.id

var oauthConf = &oauth2.Config{
    ClientID:     os.Getenv("SSO_CLIENT_ID"),
    ClientSecret: os.Getenv("SSO_CLIENT_SECRET"),
    RedirectURL:  "https://api.x.go.id/auth/callback",
    Scopes:       []string{"openid", "profile", "email", "offline_access"},
    Endpoint: oauth2.Endpoint{
        AuthURL:   ssoBase + "/authorize",
        TokenURL:  ssoBase + "/oauth/token",
        AuthStyle: oauth2.AuthStyleInParams,
    },
}

var verifier = oidc.NewVerifier(
    os.Getenv("SSO_ISSUER"), // = OIDC_ISSUER server SSO
    oidc.NewRemoteKeySet(context.Background(), ssoBase+"/.well-known/jwks.json"),
    &oidc.Config{ClientID: oauthConf.ClientID},
)
```

### `GET /auth/login`

```go
func login(c *gin.Context) {
    s := sessions.Default(c)
    state, nonce, pkce := randString(), randString(), oauth2.GenerateVerifier()
    s.Set("state", state); s.Set("nonce", nonce); s.Set("pkce", pkce)
    s.Save()

    url := oauthConf.AuthCodeURL(state,
        oauth2.S256ChallengeOption(pkce),
        oauth2.SetAuthURLParam("nonce", nonce),
    )
    c.Redirect(http.StatusFound, url)
}
```

### `GET /auth/callback`

```go
func callback(c *gin.Context) {
    s := sessions.Default(c)
    if c.Query("state") != s.Get("state") {
        c.AbortWithStatus(http.StatusBadRequest); return
    }

    tok, err := oauthConf.Exchange(c, c.Query("code"),
        oauth2.VerifierOption(s.Get("pkce").(string)))
    if err != nil { c.AbortWithStatus(http.StatusUnauthorized); return }

    rawID, _ := tok.Extra("id_token").(string)
    idTok, err := verifier.Verify(c, rawID)
    if err != nil || idTok.Nonce != s.Get("nonce") {
        c.AbortWithStatus(http.StatusUnauthorized); return
    }

    // GET /oauth/userinfo
    req, _ := http.NewRequestWithContext(c, "GET", ssoBase+"/oauth/userinfo", nil)
    req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
    // ... decode response → user

    s.Delete("state"); s.Delete("nonce"); s.Delete("pkce")
    s.Set("user", user); s.Set("token", tok); s.Set("id_token", rawID)
    s.Save()
    c.Redirect(http.StatusFound, "https://app.x.go.id/")
}
```

### `GET /auth/logout`

```go
func logout(c *gin.Context) {
    s := sessions.Default(c)
    idToken, _ := s.Get("id_token").(string)
    s.Clear(); s.Options(sessions.Options{MaxAge: -1}); s.Save()

    q := url.Values{
        "id_token_hint":            {idToken},
        "post_logout_redirect_uri": {"https://app.x.go.id/"},
    }
    c.Redirect(http.StatusFound, ssoBase+"/oauth/logout?"+q.Encode())
}
```

Refresh token cukup via `oauthConf.TokenSource(ctx, tok).Token()` — otomatis memanggil `/oauth/token` dengan `grant_type=refresh_token` bila token sudah expired; simpan kembali token baru ke sesi.

### Nuxt

```ts
// composables/useAuth.ts
const api = useRuntimeConfig().public.apiBase // https://api.x.go.id

export const useAuth = () => {
  const user = useState('user', () => null)

  const fetchMe = async () => {
    user.value = await $fetch(`${api}/auth/me`, { credentials: 'include' }).catch(() => null)
  }
  const login  = () => { window.location.href = `${api}/auth/login` }
  const logout = () => { window.location.href = `${api}/auth/logout` }

  return { user, fetchMe, login, logout }
}
```