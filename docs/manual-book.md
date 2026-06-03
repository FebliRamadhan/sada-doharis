---
title: "SADA SSO — Buku Panduan Sistem Single Sign-On"
subtitle: "Kementerian Pendayagunaan Aparatur Negara dan Reformasi Birokrasi"
author: "Tim Pengembang SADA"
date: "April 2026"
lang: id
toc: true
toc-depth: 3
numbersections: true
---

\newpage

# Pendahuluan

## Tentang Sistem SADA SSO

**SADA SSO** (Single Sign-On) adalah sistem autentikasi terpusat yang dibangun untuk Kementerian Pendayagunaan Aparatur Negara dan Reformasi Birokrasi (KemenPANRB). Sistem ini memungkinkan satu akun digunakan untuk mengakses berbagai layanan digital internal maupun eksternal, tanpa perlu login berulang kali.

Sistem ini mengimplementasikan standar industri **OAuth 2.0** dan **OpenID Connect (OIDC)**, memastikan kompatibilitas luas dengan berbagai aplikasi modern.

## Tujuan Dokumen

Buku panduan ini ditujukan untuk tiga kelompok pembaca:

| Pembaca | Bagian yang Relevan |
|---------|---------------------|
| **Pengguna Akhir** | Bab 3 (Login & Autentikasi) |
| **Administrator Sistem** | Bab 5, 6, 7 (Manajemen, Deployment, Konfigurasi) |
| **Developer Aplikasi** | Bab 8, 9 (Integrasi & API Reference) |

## Fitur Utama

- **Multi-Provider Authentication** — Dukungan LDAP (karyawan internal), SPLP (ASN/pemerintah), Google, dan Facebook
- **OAuth2 / OIDC Standar** — Compatible dengan semua aplikasi OAuth2 modern
- **PKCE Support** — Keamanan ekstra untuk aplikasi frontend/mobile
- **Session-Scoped Consent** — Persetujuan akses cukup diberikan sekali per sesi
- **Single Domain Deployment** — SSL terminate di Load Balancer, Nginx sebagai reverse proxy
- **RSA RS256 Token Signing** — Kunci kriptografi asimetris untuk JWT yang aman

\newpage

# Arsitektur Sistem

## Gambaran Umum

SADA SSO dibangun sebagai **monorepo** dengan empat komponen utama yang saling terintegrasi:

```
┌─────────────────────────────────────────────────────────────┐
│                Load Balancer (SSL Termination)               │
│                   https://auth.menpan.go.id                  │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP (port 80)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Nginx Reverse Proxy                        │
│                                                             │
│  /              → Auth UI (SPA React/Vite)                  │
│  /api/          → Auth Service                              │
│  /oauth/        → Auth Service (OIDC publik)                │
│  /.well-known/  → Auth Service (OIDC discovery)             │
│  /health        → Auth Service                              │
└───────────────┬─────────────────────┬───────────────────────┘
                │                     │
                ▼                     ▼
   ┌────────────────────┐   ┌─────────────────────┐
   │    Auth UI          │   │    Auth Service      │
   │  (Vite SPA)        │   │    (Express + OIDC)  │
   │  Login Form        │   │    Port 3001          │
   │  Consent Screen    │   │                      │
   └────────────────────┘   └──────┬───────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             ┌──────────┐  ┌──────────┐  ┌──────────┐
             │PostgreSQL │  │  Redis   │  │  MySQL   │
             │(Prisma)  │  │(Session/ │  │(Pegawai) │
             │Users,    │  │ Cache)   │  │          │
             │OAuthCode │  └──────────┘  └──────────┘
             │OAuthToken│
             └──────────┘
```

## Komponen Sistem

### Auth Service (`@sada/auth-service`) — Port 3001

Inti dari seluruh sistem. Menangani:
- Autentikasi semua provider (LDAP, SPLP, Google, Facebook, email/password)
- OAuth2 Authorization Server (authorization code, client credentials, refresh token)
- OpenID Connect (OIDC) issuer dengan JWKS endpoint
- Manajemen pengguna dan OAuth clients
- Audit logging

### Auth UI (`@sada/auth-ui`) — SPA

Antarmuka pengguna berbasis Vite/TypeScript yang menyajikan:
- Halaman login (semua provider)
- OAuth2 Consent Screen
- Served via Nginx sebagai static files

### Gateway (`@sada/gateway`) — Port 3000

Digunakan pada deployment multi-domain. Menangani:
- Verifikasi Bearer token (JWT)
- Rate limiting
- Reverse proxy ke Auth Service

> **Catatan:** Pada deployment single-domain (`auth.menpan.go.id`), gateway tidak digunakan. Nginx langsung meneruskan `/api/*` ke Auth Service.

### Data Store

| Store | Teknologi | Data yang Disimpan |
|-------|-----------|-------------------|
| PostgreSQL | Prisma ORM | Users, OAuthClient, OAuthAuthorizationCode, OAuthToken |
| Redis | ioredis | Consent session, token cache |
| MySQL | mysql2 (read-only) | Profil pegawai (`tb_master_pegawai`) |

\newpage

# Autentikasi Pengguna

## Tipe Pengguna

SADA SSO mendukung tiga tipe pengguna dengan alur autentikasi masing-masing:

| Tipe | Deskripsi | Metode Login | Scope Otomatis |
|------|-----------|--------------|----------------|
| **INTERNAL** | Karyawan internal (ASN KemenPANRB) | LDAP | `profile email internal` |
| **GOVERNMENT** | ASN dari instansi lain | SPLP (Government SSO) | `profile email government` |
| **EXTERNAL** | Masyarakat umum | Email/Password, Google, Facebook | `profile email` |

## Login Karyawan Internal (LDAP)

Karyawan dengan email domain `@menpan.go.id` dapat login melalui dua cara:

### Cara 1: Menggunakan Email Lengkap

1. Buka halaman login di `https://auth.menpan.go.id`
2. Masukkan **email** (contoh: `budi.santoso@menpan.go.id`) dan **password LDAP**
3. Sistem secara otomatis mendeteksi domain internal dan memproses via LDAP

### Cara 2: Menggunakan Username/NIP

1. Buka halaman login di `https://auth.menpan.go.id`
2. Pilih tab **"Login Karyawan"** (jika tersedia)
3. Masukkan **username** atau **NIP** (tanpa `@`) dan **password LDAP**
4. Klik **Masuk**

> **Catatan:** Password yang digunakan adalah password akun LDAP/email korporat, bukan password SSO terpisah.

### Alur Teknis LDAP

```
POST /api/auth/ldap/login
  { username: "budi.santoso", password: "..." }
  
  ├─ Verifikasi LDAP konfigurasi
  ├─ LDAP bind → search uid → return { dn, cn, mail, uid }
  ├─ Cek/buat akun di PostgreSQL (auto-provisioning)
  ├─ Ambil profil dari MySQL (tb_master_pegawai) jika ada
  └─ Return { access_token, refresh_token, user }
```

## Login ASN Pemerintah (SPLP)

Untuk ASN dari instansi lain yang memiliki akun di portal SPLP (splp.go.id):

1. Klik tombol **"Login dengan SPLP"** di halaman login
2. Anda akan diarahkan ke portal SPLP untuk autentikasi
3. Setelah berhasil, SPLP akan mengarahkan kembali ke SADA SSO
4. Akun dibuat otomatis jika belum ada (menggunakan NIP sebagai identifier)

### Alur Teknis SPLP

```
GET /api/auth/splp/authorize
  └─ Redirect ke SPLP Authorization URL

GET /api/auth/splp/callback?code=...&state=...
  ├─ Exchange code → access token SPLP
  ├─ Ambil userinfo dari SPLP (NIP, nama, email)
  ├─ Cek/buat akun di PostgreSQL
  └─ Return token
```

## Login Masyarakat Umum (External)

### Menggunakan Email dan Password

1. Buka halaman login
2. Masukkan **email** dan **password** yang telah terdaftar
3. Klik **Masuk**

Untuk mendaftar akun baru:
```
POST /api/auth/register
{ "email": "user@example.com", "password": "...", "name": "Nama Lengkap" }
```

### Menggunakan Google

1. Klik tombol **"Lanjutkan dengan Google"**
2. Pilih akun Google Anda
3. Setujui izin akses
4. Akun dibuat otomatis jika belum ada

### Menggunakan Facebook

1. Klik tombol **"Lanjutkan dengan Facebook"**
2. Login ke Facebook dan setujui izin
3. Akun dibuat otomatis

## Consent Screen (Layar Persetujuan)

Ketika sebuah aplikasi meminta akses ke akun Anda, layar persetujuan akan muncul menampilkan:
- Nama aplikasi yang meminta akses
- Daftar izin yang diminta (scope)
- Tombol **Izinkan** dan **Tolak**

### Kebijakan Persetujuan

- Persetujuan hanya perlu diberikan **sekali per sesi login**
- Selama refresh token masih valid, aplikasi yang sama tidak akan meminta persetujuan ulang
- Ketika sesi berakhir (logout atau token expired), persetujuan akan diminta lagi pada login berikutnya
- Persetujuan berlaku per-kombinasi pengguna dan aplikasi

\newpage

# OAuth2 dan OpenID Connect

## Konsep Dasar

**OAuth2** adalah protokol standar untuk otorisasi akses. Dengan OAuth2, pengguna dapat memberikan izin kepada aplikasi pihak ketiga untuk mengakses data mereka tanpa harus membagikan password.

**OpenID Connect (OIDC)** adalah lapisan identitas di atas OAuth2 yang menambahkan informasi pengguna (`id_token`) ke dalam alur autentikasi.

## OIDC Discovery

Konfigurasi OIDC lengkap tersedia di:

```
GET https://auth.menpan.go.id/.well-known/openid-configuration
```

Endpoint ini mengembalikan URL semua endpoint OIDC, algoritma yang didukung, dan informasi konfigurasi lainnya.

## Alur Authorization Code + PKCE

Alur yang direkomendasikan untuk semua jenis aplikasi, terutama aplikasi frontend (SPA) dan mobile.

```
Aplikasi Anda                Auth UI               Auth Service
      │                         │                       │
      │  1. Buat PKCE:           │                       │
      │     code_verifier (random 64 char)               │
      │     code_challenge = SHA256(verifier)            │
      │     state = random nonce                         │
      │                         │                       │
      │  2. Redirect ke:         │                       │
      │  /authorize?             │                       │
      │    response_type=code    │                       │
      │    client_id=...         │                       │
      │    redirect_uri=...      │                       │
      │    scope=openid profile email                    │
      │    state=...             │                       │
      │    code_challenge=...    │                       │
      │    code_challenge_method=S256                    │
      │────────────────────────▶│                       │
      │                         │  3. Tampilkan form login
      │                         │                       │
      │                         │  4. User login & consent
      │                         │──────────────────────▶│
      │                         │                       │
      │◀───────────────────────────────────────────────│
      │  5. Redirect ke:         │                       │
      │  redirect_uri?code=...&state=...                 │
      │                         │                       │
      │  6. Validasi state       │                       │
      │                         │                       │
      │  7. POST /oauth/token    │                       │
      │     grant_type=authorization_code                │
      │     code=...             │                       │
      │     code_verifier=...    │                       │
      │     client_id + secret   │                       │
      │─────────────────────────────────────────────── ▶│
      │                         │  8. Validasi PKCE      │
      │                         │  Generate tokens       │
      │◀─────────────────────────────────────────────── │
      │  { access_token,         │                       │
      │    refresh_token,        │                       │
      │    id_token,             │                       │
      │    expires_in }          │                       │
```

## Endpoint OAuth2

### Authorization Endpoint

```
GET /oauth/authorize
```

**Parameter:**

| Parameter | Wajib | Deskripsi |
|-----------|-------|-----------|
| `response_type` | Ya | Harus `code` |
| `client_id` | Ya | ID aplikasi yang terdaftar |
| `redirect_uri` | Ya | URL callback (harus sesuai yang terdaftar) |
| `scope` | Ya | Daftar scope yang diminta (space-separated) |
| `state` | Direkomendasikan | Nilai acak untuk mencegah CSRF |
| `code_challenge` | Direkomendasikan | Hash dari code_verifier (PKCE) |
| `code_challenge_method` | Jika PKCE | `S256` (direkomendasikan) atau `plain` |
| `nonce` | Untuk OIDC | Nilai acak untuk validasi id_token |

### Token Endpoint

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
```

**Authorization Code Grant:**

| Parameter | Nilai |
|-----------|-------|
| `grant_type` | `authorization_code` |
| `code` | Kode dari authorization endpoint |
| `redirect_uri` | URL yang sama dengan authorization request |
| `client_id` | ID aplikasi |
| `client_secret` | Secret aplikasi |
| `code_verifier` | Verifier PKCE original (jika menggunakan PKCE) |

**Client Credentials Grant:**

| Parameter | Nilai |
|-----------|-------|
| `grant_type` | `client_credentials` |
| `client_id` | ID aplikasi |
| `client_secret` | Secret aplikasi |
| `scope` | Scope yang diminta (opsional) |

**Refresh Token Grant:**

| Parameter | Nilai |
|-----------|-------|
| `grant_type` | `refresh_token` |
| `refresh_token` | Refresh token yang diperoleh sebelumnya |
| `client_id` | ID aplikasi |
| `client_secret` | Secret aplikasi |

### UserInfo Endpoint

```
GET /oauth/userinfo
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "sub": "user-id",
  "name": "Budi Santoso",
  "email": "budi.santoso@menpan.go.id",
  "picture": "https://...",
  "email_verified": true
}
```

### Revoke Endpoint

```
POST /oauth/revoke
Content-Type: application/x-www-form-urlencoded

token=<access_token_atau_refresh_token>
```

### JWKS Endpoint

```
GET /.well-known/jwks.json
```

Mengembalikan kunci publik RSA untuk verifikasi JWT secara mandiri oleh aplikasi.

## Scope yang Tersedia

| Scope | Deskripsi | Data yang Diberikan |
|-------|-----------|---------------------|
| `openid` | Wajib untuk OIDC | `sub` (user ID) |
| `profile` | Data profil | `name`, `picture` |
| `email` | Alamat email | `email`, `email_verified` |
| `offline_access` | Refresh token | Kemampuan memperbarui token |
| `internal` | Pengguna LDAP | Data internal (read-only) |
| `government` | Pengguna SPLP | Data ASN (read-only) |

## Token Expiry

| Token | Default | Konfigurasi |
|-------|---------|-------------|
| Authorization Code | 10 menit | `OAUTH_AUTHORIZATION_CODE_EXPIRES_IN` |
| Access Token (JWT) | 15 menit | `JWT_ACCESS_TOKEN_EXPIRES_IN` |
| Refresh Token | 7 hari | `JWT_REFRESH_TOKEN_EXPIRES_IN` |

\newpage

# Manajemen Sistem (Administrator)

## Manajemen Pengguna

### Melihat Daftar Pengguna

```bash
GET /api/users
Authorization: Bearer <admin_token>
```

**Query Parameters:**
- `page` — Nomor halaman (default: 1)
- `limit` — Jumlah per halaman (default: 10, maks: 100)
- `search` — Pencarian berdasarkan nama/email

### Melihat Detail Pengguna

```bash
GET /api/users/:id
Authorization: Bearer <admin_token>
```

### Menonaktifkan Pengguna

```bash
PATCH /api/users/:id
Authorization: Bearer <admin_token>
Content-Type: application/json

{ "isActive": false }
```

### Menghapus Pengguna

```bash
DELETE /api/users/:id
Authorization: Bearer <admin_token>
```

## Manajemen OAuth Client

OAuth Client adalah representasi dari aplikasi yang diizinkan menggunakan SADA SSO.

### Membuat OAuth Client Baru

```bash
POST /api/clients
Content-Type: application/json

{
  "name": "Nama Aplikasi",
  "redirectUris": ["https://app.menpan.go.id/callback"],
  "scopes": ["openid", "profile", "email", "offline_access"],
  "grants": ["authorization_code", "refresh_token"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "clientId": "abc123...",
    "clientSecret": "secret...",
    "name": "Nama Aplikasi",
    "redirectUris": ["https://app.menpan.go.id/callback"],
    "scopes": ["openid", "profile", "email", "offline_access"],
    "grants": ["authorization_code", "refresh_token"],
    "isActive": true,
    "createdAt": "2026-04-08T..."
  }
}
```

> **Penting:** Simpan `clientSecret` dengan aman. Secret hanya ditampilkan sekali saat pembuatan.

### Melihat Daftar OAuth Client

```bash
GET /api/clients
Authorization: Bearer <admin_token>
```

### Meregenerasi Secret

```bash
POST /api/clients/:id/regenerate-secret
Authorization: Bearer <admin_token>
```

> Regenerasi secret akan membuat semua token yang ada menjadi tidak valid. Aplikasi perlu diperbarui dengan secret baru.

### Mengaktifkan/Menonaktifkan Client

```bash
PATCH /api/clients/:id
Authorization: Bearer <admin_token>
Content-Type: application/json

{ "isActive": false }
```

### Menghapus OAuth Client

```bash
DELETE /api/clients/:id
Authorization: Bearer <admin_token>
```

## Health Check

```bash
GET /health
```

**Response saat sehat:**
```json
{
  "status": "ok",
  "timestamp": "2026-04-08T...",
  "services": {
    "database": "ok",
    "redis": "ok"
  }
}
```

\newpage

# Deployment dan Infrastruktur

## Persyaratan Sistem

| Komponen | Versi Minimum |
|----------|---------------|
| Docker | 24.x |
| Docker Compose | 2.x |
| RAM | 2 GB |
| Disk | 10 GB |

## Single-Domain Deployment

Deployment produksi menggunakan satu domain (`auth.menpan.go.id`) dengan arsitektur:

```
Internet
   │
   ▼
Load Balancer (SSL terminate, port 443)
   │ forward HTTP ke port 80
   ▼
Nginx Container (port 80)
   ├── / → Auth UI (static files dalam container)
   ├── /api/ → Auth Service (port 3001)
   ├── /oauth/ → Auth Service
   └── /.well-known/ → Auth Service
```

## Langkah Deployment

### 1. Persiapan Environment

Buat file `.env` dari template:

```bash
cp .env.example .env
```

Edit file `.env` dan isi variabel wajib:

```bash
# Wajib diisi
DOMAIN_URL=https://auth.menpan.go.id
JWT_SECRET=<string-acak-minimal-64-karakter>

# Database
POSTGRES_USER=sada_user
POSTGRES_PASSWORD=<password-aman>
POSTGRES_DB=sada_db

# LDAP
LDAP_URL=ldap://ldap-d.menpan.go.id:389
LDAP_BIND_DN=uid=zimbra,cn=admins,cn=zimbra
LDAP_BIND_PASSWORD=<password-ldap>
LDAP_SEARCH_BASE=ou=people,dc=menpan,dc=go,dc=id
LDAP_SEARCH_FILTER=(uid={{username}})
INTERNAL_EMAIL_DOMAIN=menpan.go.id
```

### 2. Generate JWT Secret

```bash
openssl rand -base64 48
```

Salin output dan isi ke `JWT_SECRET` di `.env`.

### 3. Persiapan Direktori Keys

```bash
mkdir -p keys
```

> RSA keys akan di-generate otomatis saat container pertama kali berjalan dan disimpan ke folder `keys/`. Folder ini harus ada sebelum container dimulai.

### 4. Jalankan Stack

```bash
docker compose -f docker-compose.single-domain.yml --env-file .env up -d
```

### 5. Verifikasi

```bash
# Cek status container
docker compose -f docker-compose.single-domain.yml ps

# Cek health
curl http://localhost/health

# Cek OIDC discovery
curl https://auth.menpan.go.id/.well-known/openid-configuration
```

### 6. Konfigurasi Load Balancer

Pastikan Load Balancer mengkonfigurasi:
- SSL termination di port 443
- Forward ke Nginx di port 80
- Header `X-Forwarded-Proto: https` dikirim ke Nginx
- Header `X-Forwarded-For` berisi IP asli client

## Backup dan Recovery

### Backup Database

```bash
docker exec sada-postgres pg_dump -U sada_user sada_db > backup_$(date +%Y%m%d).sql
```

### Backup RSA Keys

```bash
cp -r keys/ keys_backup_$(date +%Y%m%d)/
```

> RSA keys harus dibackup. Jika hilang, semua token yang ada akan tidak valid dan pengguna perlu login ulang.

### Restore Database

```bash
docker exec -i sada-postgres psql -U sada_user sada_db < backup.sql
```

## Update Sistem

```bash
# Pull image terbaru
docker compose -f docker-compose.single-domain.yml pull

# Rebuild dan restart
docker compose -f docker-compose.single-domain.yml up -d --build

# Cek log
docker compose -f docker-compose.single-domain.yml logs -f auth-service
```

\newpage

# Konfigurasi Lengkap

## Variabel Environment

### Konfigurasi Aplikasi

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `NODE_ENV` | `development` | Mode aplikasi (`production` untuk prod) |
| `AUTH_SERVICE_PORT` | `3001` | Port Auth Service |
| `LOG_LEVEL` | `info` | Level log (`debug`, `info`, `warn`, `error`) |

### Domain

| Variabel | Wajib | Deskripsi |
|----------|-------|-----------|
| `DOMAIN_URL` | Ya (prod) | URL domain utama, misal `https://auth.menpan.go.id` |

`DOMAIN_URL` secara otomatis mengisi:
- `OIDC_ISSUER` — Identifier OIDC issuer
- `CORS_ORIGIN` — Origin yang diizinkan
- Google/Facebook callback URL

### Database

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `POSTGRES_USER` | `postgres` | Username PostgreSQL |
| `POSTGRES_PASSWORD` | `postgres` | Password PostgreSQL |
| `POSTGRES_DB` | `sada_db` | Nama database |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `MYSQL_HOST` | — | Host MySQL (profil pegawai) |
| `MYSQL_PORT` | `3306` | Port MySQL |
| `MYSQL_USER` | — | Username MySQL |
| `MYSQL_PASSWORD` | — | Password MySQL |
| `MYSQL_DATABASE` | `main_db` | Database MySQL |

### JWT dan Token

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `JWT_SECRET` | — | **Wajib.** Secret untuk signing JWT (min 64 char) |
| `JWT_ACCESS_TOKEN_EXPIRES_IN` | `15m` | Masa berlaku access token |
| `JWT_REFRESH_TOKEN_EXPIRES_IN` | `7d` | Masa berlaku refresh token |
| `OAUTH_AUTHORIZATION_CODE_EXPIRES_IN` | `600` | Masa berlaku auth code (detik) |
| `OAUTH_ACCESS_TOKEN_EXPIRES_IN` | `3600` | Masa berlaku OAuth access token (detik) |
| `OAUTH_REFRESH_TOKEN_EXPIRES_IN` | `2592000` | Masa berlaku OAuth refresh token (detik) |

### RSA Keys

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `RSA_PRIVATE_KEY_PATH` | `./keys/private.pem` | Path kunci privat RSA |
| `RSA_PUBLIC_KEY_PATH` | `./keys/public.pem` | Path kunci publik RSA |
| `RSA_KEY_ID` | `key-1` | Identifier kunci (kid di JWT) |

> Keys di-generate otomatis jika file belum ada. Simpan keys dengan aman dan backup secara rutin.

### LDAP

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `LDAP_URL` | — | URL server LDAP |
| `LDAP_BIND_DN` | — | DN untuk binding ke LDAP |
| `LDAP_BIND_PASSWORD` | — | Password LDAP bind |
| `LDAP_SEARCH_BASE` | — | Base DN untuk pencarian |
| `LDAP_SEARCH_FILTER` | — | Filter pencarian, gunakan `{{username}}` sebagai placeholder |
| `INTERNAL_EMAIL_DOMAIN` | `menpan.go.id` | Domain email karyawan internal |

### SPLP (Government SSO)

| Variabel | Deskripsi |
|----------|-----------|
| `SPLP_CLIENT_ID` | Client ID dari portal SPLP |
| `SPLP_CLIENT_SECRET` | Client Secret dari portal SPLP |
| `SPLP_AUTHORIZATION_URL` | URL authorization SPLP |
| `SPLP_TOKEN_URL` | URL token exchange SPLP |
| `SPLP_USERINFO_URL` | URL userinfo SPLP |
| `SPLP_REDIRECT_URI` | Callback URL yang terdaftar di SPLP |

### Google OAuth

| Variabel | Deskripsi |
|----------|-----------|
| `GOOGLE_CLIENT_ID` | Client ID dari Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Client Secret Google |

### Facebook OAuth

| Variabel | Deskripsi |
|----------|-----------|
| `FACEBOOK_APP_ID` | App ID dari Meta Developer Console |
| `FACEBOOK_APP_SECRET` | App Secret Facebook |

### Rate Limiting

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window rate limit (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Maks request per window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | Window rate limit auth endpoint (ms) |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | `5` | Maks request auth per window |
| `TOKEN_RATE_LIMIT_MAX_REQUESTS` | `10` | Maks request token endpoint per window |

### Lain-lain

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `AUDIT_LOG_ENABLED` | `true` | Aktifkan audit log |
| `TOKEN_CLEANUP_INTERVAL_MS` | `3600000` | Interval cleanup token expired (ms) |
| `CORS_ORIGIN` | (dari DOMAIN_URL) | Daftar origin CORS yang diizinkan |

\newpage

# Panduan Integrasi Developer

## Pendahuluan

Untuk mengintegrasikan aplikasi Anda dengan SADA SSO, Anda memerlukan:

1. **OAuth Client** — Daftar aplikasi Anda ke admin SADA SSO untuk mendapatkan `client_id` dan `client_secret`
2. **Redirect URI** — URL di aplikasi Anda yang akan menerima authorization code
3. **Pemahaman PKCE** — Untuk keamanan ekstra pada aplikasi frontend

## Alur Integrasi Step-by-Step

### Langkah 1: Dapatkan OAuth Client

Hubungi admin SADA SSO atau buat sendiri jika memiliki akses:

```bash
curl -X POST https://auth.menpan.go.id/api/clients \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nama Aplikasi Saya",
    "redirectUris": ["https://app.contoh.go.id/callback"],
    "scopes": ["openid", "profile", "email", "offline_access"],
    "grants": ["authorization_code", "refresh_token"]
  }'
```

Catat `clientId` dan `clientSecret` dari response.

### Langkah 2: Implementasi PKCE

```javascript
// Buat code_verifier
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Buat code_challenge
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate state untuk CSRF protection
function generateState() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
```

### Langkah 3: Inisiasi Login

```javascript
async function initiateLogin() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  
  // Simpan di sessionStorage
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'YOUR_CLIENT_ID',
    redirect_uri: 'https://app.contoh.go.id/callback',
    scope: 'openid profile email offline_access',
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  
  window.location.href = 
    `https://auth.menpan.go.id/oauth/authorize?${params}`;
}
```

### Langkah 4: Handle Callback

```javascript
async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  
  if (error) {
    throw new Error(`OAuth error: ${error}`);
  }
  
  // Validasi state
  const savedState = sessionStorage.getItem('oauth_state');
  if (state !== savedState) {
    throw new Error('State mismatch — kemungkinan CSRF attack');
  }
  
  const verifier = sessionStorage.getItem('pkce_verifier');
  
  // Exchange code untuk token
  const response = await fetch(
    'https://auth.menpan.go.id/api/oauth/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'https://app.contoh.go.id/callback',
        client_id: 'YOUR_CLIENT_ID',
        client_secret: 'YOUR_CLIENT_SECRET',
        code_verifier: verifier,
      }),
    }
  );
  
  const tokens = await response.json();
  
  // Simpan token
  localStorage.setItem('access_token', tokens.access_token);
  localStorage.setItem('refresh_token', tokens.refresh_token);
  
  // Bersihkan sessionStorage
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('oauth_state');
  
  return tokens;
}
```

### Langkah 5: Ambil Data Pengguna

```javascript
async function getUserInfo(accessToken) {
  const response = await fetch(
    'https://auth.menpan.go.id/api/oauth/userinfo',
    {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }
  );
  return response.json();
}
```

### Langkah 6: Refresh Token

```javascript
async function refreshAccessToken(refreshToken) {
  const response = await fetch(
    'https://auth.menpan.go.id/api/oauth/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'YOUR_CLIENT_ID',
        client_secret: 'YOUR_CLIENT_SECRET',
      }),
    }
  );
  
  if (!response.ok) {
    // Token expired — arahkan ke login
    initiateLogin();
    return;
  }
  
  return response.json();
}
```

## Contoh Integrasi Laravel

```php
<?php
// config/sada-sso.php
return [
    'base_url'      => env('SADA_SSO_URL', 'https://auth.menpan.go.id'),
    'client_id'     => env('SADA_CLIENT_ID'),
    'client_secret' => env('SADA_CLIENT_SECRET'),
    'redirect_uri'  => env('SADA_REDIRECT_URI'),
    'scopes'        => ['openid', 'profile', 'email', 'offline_access'],
];

// routes/web.php
Route::get('/auth/sso', [SSOController::class, 'redirect']);
Route::get('/auth/sso/callback', [SSOController::class, 'callback']);

// app/Http/Controllers/SSOController.php
class SSOController extends Controller
{
    public function redirect(Request $request)
    {
        $verifier = $this->generateVerifier();
        $challenge = $this->generateChallenge($verifier);
        $state = Str::random(40);
        
        session(['pkce_verifier' => $verifier, 'oauth_state' => $state]);
        
        $params = http_build_query([
            'response_type'         => 'code',
            'client_id'             => config('sada-sso.client_id'),
            'redirect_uri'          => config('sada-sso.redirect_uri'),
            'scope'                 => implode(' ', config('sada-sso.scopes')),
            'state'                 => $state,
            'code_challenge'        => $challenge,
            'code_challenge_method' => 'S256',
        ]);
        
        return redirect(config('sada-sso.base_url') . '/oauth/authorize?' . $params);
    }
    
    public function callback(Request $request)
    {
        // Validasi state
        abort_if($request->state !== session('oauth_state'), 403, 'State mismatch');
        
        // Exchange code
        $response = Http::asForm()->post(
            config('sada-sso.base_url') . '/api/oauth/token',
            [
                'grant_type'    => 'authorization_code',
                'code'          => $request->code,
                'redirect_uri'  => config('sada-sso.redirect_uri'),
                'client_id'     => config('sada-sso.client_id'),
                'client_secret' => config('sada-sso.client_secret'),
                'code_verifier' => session('pkce_verifier'),
            ]
        );
        
        $tokens = $response->json();
        
        // Ambil user info
        $userInfo = Http::withToken($tokens['access_token'])
            ->get(config('sada-sso.base_url') . '/api/oauth/userinfo')
            ->json();
        
        // Login atau buat user
        $user = User::updateOrCreate(
            ['email' => $userInfo['email']],
            ['name' => $userInfo['name']]
        );
        
        Auth::login($user);
        session(['sso_access_token' => $tokens['access_token']]);
        
        return redirect('/dashboard');
    }
}
```

## Verifikasi Token JWT Secara Mandiri

Aplikasi dapat memverifikasi JWT secara lokal tanpa menghubungi server menggunakan JWKS:

```javascript
import jose from 'jose';

async function verifyToken(token) {
  // Ambil JWKS dari server
  const JWKS = jose.createRemoteJWKSet(
    new URL('https://auth.menpan.go.id/.well-known/jwks.json')
  );
  
  try {
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: 'https://auth.menpan.go.id',
    });
    
    return payload; // { sub, type, scopes, iat, exp }
  } catch (err) {
    throw new Error('Token tidak valid: ' + err.message);
  }
}
```

\newpage

# API Reference Lengkap

## Autentikasi

### POST /api/auth/login
Login dengan email/username dan password.

**Request:**
```json
{
  "email": "user@menpan.go.id",
  "password": "password123"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@menpan.go.id",
      "name": "Budi Santoso",
      "userType": "INTERNAL",
      "isActive": true
    },
    "access_token": "<JWT>",
    "token_type": "Bearer",
    "expires_in": 900,
    "refresh_token": "<opaque>"
  }
}
```

### POST /api/auth/ldap/login
Login eksplisit via LDAP.

**Request:**
```json
{
  "username": "budi.santoso",
  "password": "password_ldap"
}
```

### POST /api/auth/register
Mendaftarkan pengguna baru (EXTERNAL).

**Request:**
```json
{
  "email": "user@gmail.com",
  "password": "password123",
  "name": "Nama Lengkap"
}
```

### POST /api/auth/logout
Logout dan revoke token.

**Headers:** `Authorization: Bearer <access_token>`

### GET /api/auth/me
Mendapatkan data pengguna yang sedang login.

**Headers:** `Authorization: Bearer <access_token>`

### GET /api/auth/splp/authorize
Inisiasi login SPLP (redirect ke portal SPLP).

### GET /api/auth/google
Inisiasi login Google (redirect ke Google).

### GET /api/auth/facebook
Inisiasi login Facebook (redirect ke Facebook).

---

## OAuth2

### GET /oauth/authorize
Authorization endpoint. Lihat section OAuth2 untuk detail parameter.

### POST /oauth/token
Token endpoint. Lihat section OAuth2 untuk detail parameter.

### POST /oauth/revoke
Revoke token.

**Request (form-urlencoded):**
```
token=<access_or_refresh_token>
```

### GET /oauth/userinfo
UserInfo endpoint (OIDC).

**Headers:** `Authorization: Bearer <access_token>`

### GET /.well-known/openid-configuration
OIDC Discovery Document.

### GET /.well-known/jwks.json
JSON Web Key Set untuk verifikasi JWT.

---

## Pengguna

### GET /api/users
Daftar pengguna (admin only).

**Query:** `page`, `limit`, `search`

### GET /api/users/:id
Detail pengguna.

### PATCH /api/users/:id
Update pengguna (diri sendiri atau admin).

**Request:**
```json
{
  "name": "Nama Baru",
  "isActive": true
}
```

### DELETE /api/users/:id
Hapus pengguna (diri sendiri atau admin).

---

## OAuth Client

### GET /api/clients
Daftar OAuth client.

### POST /api/clients
Buat OAuth client baru.

### GET /api/clients/:id
Detail OAuth client.

### PATCH /api/clients/:id
Update OAuth client.

### DELETE /api/clients/:id
Hapus OAuth client.

### POST /api/clients/:id/regenerate-secret
Regenerasi client secret.

---

## Error Codes

| HTTP Status | Error Code | Deskripsi |
|-------------|------------|-----------|
| 400 | `VALIDATION_ERROR` | Parameter request tidak valid |
| 401 | `UNAUTHORIZED` | Token tidak ada atau tidak valid |
| 401 | `TOKEN_EXPIRED` | Token sudah kadaluarsa |
| 401 | `INVALID_CREDENTIALS` | Username/password salah |
| 401 | `INVALID_GRANT` | Grant tidak valid (auth code / refresh token) |
| 403 | `FORBIDDEN` | Tidak memiliki izin |
| 403 | `INSUFFICIENT_SCOPE` | Scope token tidak mencukupi |
| 404 | `NOT_FOUND` | Resource tidak ditemukan |
| 429 | `TOO_MANY_REQUESTS` | Rate limit tercapai |
| 500 | `INTERNAL_ERROR` | Error server internal |

**Format Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Username atau password tidak valid"
  }
}
```

\newpage

# Keamanan

## Fitur Keamanan yang Diimplementasikan

### PKCE (Proof Key for Code Exchange)
Mencegah authorization code interception attack pada aplikasi public client (SPA, mobile). Gunakan `code_challenge_method=S256` untuk keamanan maksimal.

### RSA RS256 Token Signing
Access token ditandatangani menggunakan kunci privat RSA 2048-bit. Pihak mana pun dapat memverifikasi keaslian token menggunakan kunci publik dari JWKS endpoint tanpa perlu menghubungi server.

### LDAP Injection Prevention
Input username di-escape menggunakan RFC 4515 sebelum digunakan dalam LDAP filter, mencegah LDAP injection attack.

### Token Rotation
Setiap refresh token yang digunakan akan dihapus dan digantikan dengan refresh token baru, mencegah token replay attack.

### Rate Limiting
- Endpoint login: maksimal 5 request per menit
- Endpoint token: maksimal 10 request per menit
- Endpoint umum: maksimal 100 request per menit

### Session-Scoped Consent
Data persetujuan OAuth disimpan di Redis dengan TTL yang sama dengan refresh token. Ketika sesi berakhir, consent otomatis terhapus.

### Security Headers
Nginx menginjeksikan security headers standar:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

## Rekomendasi Keamanan

1. **Selalu gunakan HTTPS** — Pastikan Load Balancer mengaktifkan HTTPS
2. **Rotate JWT_SECRET secara berkala** — Minimal setiap 6 bulan
3. **Backup RSA keys** — Hilangnya keys = semua pengguna harus login ulang
4. **Monitor audit log** — Aktifkan `AUDIT_LOG_ENABLED=true`
5. **Batasi CORS Origin** — Jangan gunakan wildcard `*` di production
6. **Simpan client_secret dengan aman** — Jangan taruh di repository git
7. **Gunakan PKCE** — Wajib untuk aplikasi SPA/mobile

## Audit Logging

Ketika `AUDIT_LOG_ENABLED=true`, sistem mencatat semua event penting:
- Login berhasil/gagal
- Logout
- Token refresh
- OAuth authorization

Log dapat diakses via:
```bash
docker compose logs auth-service | grep "audit"
```

\newpage

# Troubleshooting

## Masalah Umum

### Login Gagal dengan "Invalid Credentials"

**Kemungkinan penyebab:**
1. Password salah
2. Akun belum terdaftar
3. Akun dinonaktifkan

**Solusi:**
- Pastikan email/username benar
- Untuk karyawan internal: gunakan password LDAP/email korporat
- Hubungi admin jika akun dinonaktifkan

### Error "RSA Keys Not Found"

```
FATAL: Cannot load RSA keys from /app/keys/private.pem
```

**Solusi:**
```bash
mkdir -p keys
docker compose -f docker-compose.single-domain.yml up -d
```

RSA keys akan di-generate otomatis pada boot pertama.

### Error "Token Expired"

Access token berlaku 15 menit. Gunakan refresh token untuk mendapatkan access token baru:

```bash
curl -X POST https://auth.menpan.go.id/api/oauth/token \
  -d "grant_type=refresh_token" \
  -d "refresh_token=<token>" \
  -d "client_id=<id>" \
  -d "client_secret=<secret>"
```

### Consent Screen Muncul Berulang

Consent hanya berlaku selama sesi. Jika consent diminta lagi, kemungkinan:
- Refresh token sudah expired (sesi berakhir)
- Redis restart (data consent hilang)

Ini adalah perilaku yang diharapkan untuk keamanan.

### CORS Error

Pastikan `DOMAIN_URL` sudah diset dengan benar di `.env`. Untuk development, tambahkan origin ke `CORS_ORIGIN`:

```
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

### Health Check Gagal

```bash
# Cek log
docker compose -f docker-compose.single-domain.yml logs auth-service

# Cek koneksi database
docker exec sada-auth-service curl -s http://localhost:3001/health
```

## Kontak Support

Untuk bantuan teknis, hubungi tim pengembang SADA melalui:
- **Email:** it-support@menpan.go.id
- **GitHub Issues:** Buat issue di repository SADA SSO

---

*Dokumen ini terakhir diperbarui: April 2026*
*Versi sistem: SADA SSO v1.0*
