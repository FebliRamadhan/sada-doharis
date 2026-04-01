# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Penggunaan Serena (MCP) - Prioritas Pencarian Kode
* **Wajib Onboarding:** Sebelum mengerjakan tugas besar, gunakan tool `serena` untuk melakukan indexing jika folder `.serena/memories` belum ada atau sudah usang.
* **Search vs Read:** Jangan pernah menggunakan `read_file` pada banyak file sekaligus. Gunakan `serena` untuk melakukan pencarian semantik (semantic search) guna menemukan fungsi, class, atau logic yang relevan.
* **Context Retrieval:** Hanya minta cuplikan kode yang benar-benar dibutuhkan untuk menyelesaikan task.

## 2. Penggunaan RTK (Rust Token Killer) - Terminal Efficiency
* **Wajib Prefix:** Kamu WAJIB menambahkan prefix `rtk` di depan SEMUA perintah terminal yang menghasilkan output teks.
    * Gunakan `rtk ls` daripada `ls`.
    * Gunakan `rtk git status` daripada `git status`.

## 3. Workflow Backend & Debugging
* **Query Debugging:** Jika diminta menganalisis query yang lambat atau error, jangan baca seluruh file log Laravel. Gunakan `rtk tail -n 50 *.log` atau filter langsung menggunakan `grep`.

## 4. Gaya Komunikasi
* Berikan penjelasan yang ringkas dan langsung ke solusi (concise).
* Gunakan blok kode hanya untuk bagian yang perlu diubah. Jangan menulis ulang seluruh file jika hanya satu fungsi yang diganti.


## Commands

```bash
# Development
pnpm dev                    # Run all packages in parallel (watch mode)
pnpm dev:ui                 # Run only auth-ui

# Build & Test
pnpm build                  # Build all packages
pnpm test                   # Run all tests (Vitest)
pnpm test:watch             # Watch mode
pnpm test:coverage          # With coverage
pnpm test:integration       # Integration tests only

# Run a single test file
pnpm vitest run packages/auth-service/src/__tests__/ldap.service.test.ts

# Lint & Format
pnpm lint                   # ESLint check
pnpm lint:fix               # Auto-fix ESLint
pnpm format                 # Prettier write
pnpm format:check           # Prettier check

# Database (Prisma)
pnpm db:generate            # Generate Prisma client (unified schema)
pnpm db:migrate             # Run migrations
pnpm db:generate:all        # Generate all multi-DB clients
pnpm db:studio              # Open Prisma Studio

# Docker
pnpm docker:dev             # Start dev stack (postgres + redis + services)
pnpm docker:gravitee        # Start with Gravitee.io API management
pnpm docker:prod            # Production build & start
```

## Architecture

This is a **pnpm monorepo** (`packages/*`) implementing an OAuth2 authorization server with an API gateway, supporting multiple auth providers for an Indonesian government/enterprise context.

### Packages

| Package | Port | Role |
|---------|------|------|
| `@sada/shared` | — | Shared types, logger (Winston), error classes, response helpers |
| `@sada/gateway` | 3000 | API Gateway — rate limiting, Bearer token verification, HTTP proxy to auth-service |
| `@sada/auth-service` | 3001 | OAuth2 server + all auth logic, Prisma ORM, Swagger docs |
| `@sada/auth-ui` | 3002 | Vite SPA — OAuth2 consent/login UI served via Nginx |
| `@sada/sso-demo-client` | — | Demo OAuth2 client (private, not deployed) |

### Data Stores

- **PostgreSQL** — primary store via Prisma. Two schema modes:
  - Unified: `prisma/schema.prisma`
  - Multi-DB: `prisma/databases/{auth,main,reporting}/schema.prisma` with separate `DATABASE_AUTH_URL`, `DATABASE_MAIN_URL`, `DATABASE_REPORTING_URL`
- **Redis** — token/session cache (`ioredis`)
- **MySQL** — read-only employee profiles (`tb_master_pegawai`) via `mysql2`

### Authentication Providers

Three user types map to distinct auth providers:
- **INTERNAL** (`UserType.INTERNAL`) — LDAP (company intranet employees)
- **GOVERNMENT** (`UserType.GOVERNMENT`) — SPLP OAuth2 (government SSO / ASN)
- **EXTERNAL** (`UserType.EXTERNAL`) — Google/Facebook via Passport.js

### OAuth2 Flows

The auth-service implements full OAuth2 in `packages/auth-service/src/services/oauth.service.ts`:
1. **Authorization Code** (with PKCE) — for interactive user login
2. **Client Credentials** — for service-to-service
3. **Refresh Token** — token renewal

JWT access tokens are issued with configurable expiry (`JWT_ACCESS_TOKEN_EXPIRES_IN`, `OAUTH_ACCESS_TOKEN_EXPIRES_IN`). The gateway verifies Bearer tokens and checks scopes before proxying.

### Request Flow

```
Client → Gateway (3000) → [rate limit + Bearer verify] → Auth Service (3001)
Auth Service → PostgreSQL / Redis / LDAP / MySQL / SPLP / Google / Facebook
```

### TypeScript Config

Root `tsconfig.base.json`: target ES2022, `module: NodeNext` (ESM). Each package extends it. All packages use ESM (`"type": "module"` in root package.json).

### Testing

Vitest with node environment. Unit tests: `packages/**/*.test.ts`. Integration tests use a separate config (`vitest.integration.config.ts`) and require `TEST_DATABASE_URL` / `TEST_API_URL` env vars.
