# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Sprint 1 & 2 Production Hardening

### Added

- **Account lockout** — 5 failed login attempts mengunci akun selama 15 menit. Berlaku untuk semua jalur password (LDAP `loginWithLdap`, `loginWithPassword`, dan password lokal). Pre-check dilakukan sebelum LDAP bind agar directory tidak di-hammer. Konfigurasi via `MAX_FAILED_LOGIN_ATTEMPTS` dan `LOGIN_LOCKOUT_MINUTES`.
  - Field baru: `User.failedLoginAttempts`, `User.lockedUntil`.
  - Audit action baru: `ACCOUNT_LOCKED`.
- **Authorization code reuse detection** (RFC 6749 §4.1.2) — auth code sekarang single-use. Jika code yang sudah dipakai dicoba lagi, seluruh token user/client pasangan tersebut direvoke (mengindikasikan code interception).
  - Field baru: `OAuthAuthorizationCode.used`.
- **CSRF protection** pada cookie-bearing endpoints (`/auth/login`, `/auth/ldap/login`, `/auth/register`, `/auth/logout`, consent approval) via validasi `Origin`/`Referer` terhadap allow-list CORS. Middleware baru: `packages/auth-service/src/middleware/csrf.ts`.
- **Environment validation di startup** — fail-fast jika `JWT_SECRET` lemah (<32 char atau nilai default), `SESSION_COOKIE_SECRET` lemah, RSA key paths hilang, atau `DATABASE_URL`/`REDIS_URL`/`OIDC_ISSUER` tidak diset di production. Files: `packages/auth-service/src/config/env.ts`, `packages/gateway/src/config/env.ts`.
- **Real readiness checks** — `/health/ready` pada auth-service ping PostgreSQL + Redis; pada gateway ping Redis + auth-service downstream (2s timeout via AbortController). Returns 503 jika ada yang down.
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — Postgres 16 + Redis 7 services, install/lint/build/test, Prisma migrate deploy, Docker smoke build untuk image auth-service dan gateway.
- **CHANGELOG.md** (file ini).

### Changed

- **Helmet hardening** (auth-service + gateway) — HSTS 2 tahun + preload di production, `strict-origin-when-cross-origin` referrer policy, COOP `same-origin`, CORP `same-site`. HSTS di-disable di dev agar tidak mem-poison browser saat akses `http://localhost`.
- **Token cleanup scheduler** sekarang membersihkan authorization code yang expired sekaligus (sebelumnya hanya token).
- **`.env.example`** ditambahkan variabel `MAX_FAILED_LOGIN_ATTEMPTS=5` dan `LOGIN_LOCKOUT_MINUTES=15`.
- **Multi-DB Prisma schema** (`prisma/databases/auth/schema.prisma`) sinkron dengan unified schema (tambah `nonce`, `failedLoginAttempts`, `lockedUntil`, `used`).

### Security

- Authorization code interception sekarang terdeteksi & memicu revoke token (defense in depth terhadap PKCE downgrade / code leak).
- Brute force terhadap password (lokal & LDAP) dimitigasi via lockout.
- CSRF pada session-cookie flows dimitigasi tanpa perlu token-per-form (Origin-based, cocok untuk SPA).
- Production tidak akan boot jika rahasia/RSA key tidak aman — menghilangkan kelas bug "deploy with default secret".

### Database

Migration baru: `prisma/migrations/20260516012424_add_account_lockout_and_code_used/migration.sql`

```sql
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "OAuthAuthorizationCode" ADD COLUMN "used" BOOLEAN NOT NULL DEFAULT false;
```

Jalankan dengan `pnpm db:migrate` (development) atau `prisma migrate deploy` (production).

### Skipped (intentional)

- Email verification — di luar scope SSO internal.
- Password reset flow — LDAP password di-reset via Zimbra, bukan aplikasi ini.

### Upgrade Notes

1. Set env wajib di production: `JWT_SECRET` (≥32 char, bukan default), `SESSION_COOKIE_SECRET`, `DATABASE_URL`, `REDIS_URL`, `OIDC_ISSUER`, `JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`. Service akan menolak start jika tidak lengkap.
2. Jalankan migration sebelum deploy versi baru.
3. Pastikan `CORS_ORIGIN` di-set ke daftar origin frontend yang valid — CSRF middleware menggunakan list ini sebagai allow-list.
4. Update reverse proxy untuk meneruskan header `Origin` dan `Referer` apa adanya (jangan strip).
