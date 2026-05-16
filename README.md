# SADA API - Services & Gateway with OAuth2

A modern API Services and API Gateway boilerplate built with Node.js, Express, and OAuth2 authentication. Supports multiple authentication methods including LDAP (internal users), SPLP (government users), and Social Auth (Google, Facebook).

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Apps                            │
│         (Web App, Mobile App, Third-Party Clients)          │
└─────────────────────────┬───────────────────────────────────┘
                          │
         ┌────────────────┴────────────────┐
         │                                 │
         ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────┐
│   Gravitee.io API   │ ◄─────► │   Custom Gateway    │
│   Management :8082  │         │      :3000          │
└─────────────────────┘         └──────────┬──────────┘
                                           │
                                           ▼
                                ┌─────────────────────┐
                                │   Auth Service      │
                                │      :3001          │
                                └──────────┬──────────┘
                                           │
          ┌────────────────┬───────────────┼───────────────┐
          │                │               │               │
          ▼                ▼               ▼               ▼
     ┌────────┐      ┌─────────┐     ┌─────────┐    ┌──────────┐
     │  LDAP  │      │  SPLP   │     │ Google  │    │ Facebook │
     │Internal│      │ Gov SSO │     │  OAuth  │    │  OAuth   │
     └────────┘      └─────────┘     └─────────┘    └──────────┘
```

## 📋 Features

- **Monorepo Structure** - pnpm workspaces
- **API Gateway** - Rate limiting, auth middleware, proxy routing
- **OAuth2 Server** - Authorization Code, Client Credentials, Refresh Token, PKCE
- **Auth UI (SPA)** - Login, OAuth consent, callback handling
- **Multiple Auth Providers**:
  - LDAP for internal users (karyawan)
  - SPLP for government users (ASN)
  - Google OAuth for external users
  - Facebook OAuth for external users
- **MySQL Integration** - `tb_master_pegawai` for internal user profiles
- **Gravitee.io Integration** - API Management & Developer Portal
- **PostgreSQL + Prisma** - Type-safe database access
- **Docker Ready** - Development & production configurations

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose (for development)

### Installation

```bash
# Clone repository
git clone <repo-url>
cd sada-api

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Generate Prisma client
pnpm db:generate
```

### Development

```bash
# Start database and services
docker-compose up -d postgres redis

# Run database migrations
pnpm db:migrate

# Start development servers
pnpm dev
```

Services will be available at:
- **Gateway**: http://localhost:3000
- **Auth Service**: http://localhost:3001
- **Auth UI**: http://localhost:3002
- **API Docs**: http://localhost:3001/api-docs

### Docker (Full Stack)

```bash
# Start all services
docker-compose up -d

# Start with Gravitee.io API Management
docker-compose -f docker-compose.gravitee.yml up -d
```

## 📁 Project Structure

```
sada-api/
├── packages/
│   ├── shared/              # Shared types & utilities
│   │   └── src/
│   │       ├── types/       # TypeScript interfaces
│   │       └── utils/       # Logger, responses, errors
│   │
│   ├── gateway/             # API Gateway
│   │   └── src/
│   │       ├── middleware/  # Auth, rate limit, errors
│   │       └── routes/      # Proxy routes
│   │
│   ├── auth-service/        # Auth & OAuth2 Service
│   │   └── src/
│   │       ├── config/      # Database, Passport
│   │       ├── middleware/  # Error handling
│   │       ├── routes/      # API endpoints
│   │       └── services/    # Business logic
│   │
│   └── auth-ui/             # SSO Login UI (SPA)
│       └── src/
│           ├── pages/       # Page components
│           ├── router.ts    # Client-side router
│           └── api.ts       # API client
│
├── prisma/
│   └── schema.prisma        # Database schema
│
├── docker/
│   ├── Dockerfile.gateway
│   └── Dockerfile.auth
│
├── docker-compose.yml       # Development stack
└── docker-compose.gravitee.yml  # API Management stack
```

## 🔐 Authentication Flows

### 1. Email Login (with LDAP for internal users)
```bash
POST /auth/login
{
  "email": "user@example.com",
  "password": "password123"
}
```
> **Note**: Internal domain emails (e.g., `@bpjstk.go.id`) are automatically authenticated via LDAP and profile is fetched from `tb_master_pegawai`.

### 2. SPLP Login (Government Users)
```bash
# Redirect to SPLP
GET /auth/splp/authorize

# Callback (automatic)
GET /auth/splp/callback?code=xxx
```

### 3. Social Login
```bash
# Google
GET /auth/google

# Facebook
GET /auth/facebook
```

## 🔑 OAuth2 Endpoints

### Authorization Code Flow (with PKCE)
```bash
# 1. Get authorization code
GET /oauth/authorize?
  response_type=code&
  client_id=xxx&
  redirect_uri=https://app.com/callback&
  scope=openid profile email&
  code_challenge=xxx&
  code_challenge_method=S256

# 2. Exchange code for tokens
POST /oauth/token
{
  "grant_type": "authorization_code",
  "client_id": "xxx",
  "client_secret": "xxx",
  "code": "xxx",
  "redirect_uri": "https://app.com/callback",
  "code_verifier": "xxx"
}
```

### Client Credentials Flow
```bash
POST /oauth/token
{
  "grant_type": "client_credentials",
  "client_id": "xxx",
  "client_secret": "xxx",
  "scope": "read:api"
}
```

### Refresh Token
```bash
POST /oauth/token
{
  "grant_type": "refresh_token",
  "client_id": "xxx",
  "client_secret": "xxx",
  "refresh_token": "xxx"
}
```

## 🔧 Environment Variables

See `.env.example` for all available configuration options.

### Core
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `JWT_SECRET` - JWT signing key
- `SESSION_COOKIE_SECRET` - Signs the `sada_sid` SSO cookie that enables cross-app SSO. Falls back to `JWT_SECRET` if unset; **must be set in production**
- `SESSION_TTL` - SSO session lifetime (default `7d`)
- `SESSION_COOKIE_DOMAIN` - Parent domain to share the SSO cookie across subdomains (e.g. `.example.com`); leave empty for single-host setups

### MySQL (Internal User Profiles)
- `MYSQL_HOST` - MySQL server host
- `MYSQL_PORT` - MySQL port (default: 3306)
- `MYSQL_USER` - MySQL username
- `MYSQL_PASSWORD` - MySQL password
- `MYSQL_DATABASE` - Database name
- `INTERNAL_EMAIL_DOMAIN` - Domain for internal users (e.g., `bpjstk.go.id`)

### Authentication
- `LDAP_*` - LDAP server configuration
- `SPLP_*` - SPLP OAuth configuration
- `GOOGLE_*` / `FACEBOOK_*` - Social OAuth

## 📚 API Reference

### Health Check
- `GET /health` - Service health
- `GET /health/ready` - Readiness check

### Authentication
- `POST /auth/login` - Email/password login
- `POST /auth/register` - User registration
- `POST /auth/logout` - Logout
- `GET /auth/me` - Current user info

### OAuth
- `GET /oauth/authorize` - Authorization endpoint
- `POST /oauth/token` - Token endpoint
- `POST /oauth/revoke` - Revoke token
- `GET /.well-known/openid-configuration` - OIDC discovery

### OAuth Clients
- `POST /clients` - Create client
- `GET /clients` - List clients
- `GET /clients/:id` - Get client
- `PATCH /clients/:id` - Update client
- `DELETE /clients/:id` - Delete client

### Users
- `GET /users/:id` - Get user
- `PATCH /users/:id` - Update user
- `DELETE /users/:id` - Deactivate user

## 🐳 Gravitee.io Setup

After starting Gravitee.io stack:

1. Access Admin Console: http://localhost:8084
2. Default credentials: admin / admin
3. Access Developer Portal: http://localhost:8085

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific package tests
pnpm --filter @sada/auth-service test
```

## 📝 License

MIT
