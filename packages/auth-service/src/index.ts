import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createLogger } from '@sada/shared';

import { validateEnv } from './config/env.js';
import { parseAllowedOrigins, isOriginAllowed } from './utils/origin.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { oauthRoutes } from './routes/oauth.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { mfaRoutes } from './routes/mfa.routes.js';
import { clientRoutes } from './routes/client.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { oidcRoutes } from './routes/oidc.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { initPassport } from './config/passport.js';
import { setupSwagger } from './swagger.js';
import { prisma } from './config/database.js';
import { disconnectAllDatabases } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { tokenService } from './services/token.service.js';

const logger = createLogger('auth-service');

// Fail fast if required env vars are missing/weak — keys/secrets must be set before
// anything else loads (token.service evaluates JWT_SECRET at import time).
validateEnv();

const app = express();

// TLS diterminasi di reverse proxy di depan service ini, sehingga tanpa baris
// ini `req.protocol` selalu bernilai 'http' meski permintaannya datang lewat
// HTTPS. Akibatnya bukan kosmetik: dokumen discovery OIDC menyusun seluruh
// alamatnya dari `req.protocol`, sehingga ia mengiklankan
// `http://.../oauth/token` — dan klien yang patuh akan mengirimkan
// `client_secret` miliknya ke sana sebagai teks polos sebelum sempat
// dialihkan ke HTTPS. Kebocorannya senyap: alurnya tetap berhasil.
//
// Nilai 1 berarti mempercayai TEPAT SATU proxy terdekat. Jangan diubah menjadi
// `true`: itu mempercayai seluruh rantai X-Forwarded-For, sehingga klien mana
// pun dapat memalsukan alamat asalnya.
app.set('trust proxy', 1);

const PORT = process.env['AUTH_SERVICE_PORT'] ?? 3001;

// Security middlewares
const IS_PROD = process.env['NODE_ENV'] === 'production';
app.use(
  helmet({
    // HSTS is only enforced in production behind TLS; sending it in dev over
    // http://localhost can poison browsers for local development.
    hsts: IS_PROD
      ? { maxAge: 63072000, includeSubDomains: true, preload: true } // 2 years
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    // The auth UI lives on a different origin and loads via <script type=module>;
    // helmet's default CSP would block it. Issuers that want CSP should configure
    // it at the reverse proxy where origin/script sources are known.
    contentSecurityPolicy: false,
  })
);
const corsAllowedOrigins = parseAllowedOrigins(process.env['CORS_ORIGIN'], [
  'http://localhost:3000',
  'http://localhost:3002',
]);
app.use(
  cors({
    // Function form so wildcard patterns (e.g. https://*.menpan.go.id) are honored.
    // No Origin header (server-to-server, curl) is allowed through.
    origin: (origin, cb) => cb(null, !origin || isOriginAllowed(origin, corsAllowedOrigins)),
    credentials: true,
  })
);

// Strip internal identity headers — only the gateway is allowed to set these
app.use((_req, _res, next) => {
  delete _req.headers['x-user-id'];
  delete _req.headers['x-user-type'];
  delete _req.headers['x-user-scopes'];
  next();
});

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieParser(
    process.env['SESSION_COOKIE_SECRET'] ?? process.env['JWT_SECRET'] ?? 'dev-cookie-secret'
  )
);

// Initialize Passport
initPassport(app);

// Logging & request ID
app.use(requestId);
app.use(
  morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// Swagger API docs
setupSwagger(app);

// Routes
app.use('/health', healthRoutes);
app.use('/', oidcRoutes); // /.well-known/jwks.json (root-level OIDC discovery)
app.use('/oauth', oauthRoutes);
app.use('/oauth', oidcRoutes); // /oauth/userinfo, /oauth/introspect, /oauth/logout
app.use('/auth', authRoutes);
// MFA routes declare absolute paths (/auth/mfa/*, /admin/mfa/*) → mount at root.
app.use('/', mfaRoutes);
app.use('/clients', clientRoutes);
app.use('/users', userRoutes);
app.use('/audit-logs', auditRoutes);

// Error handling
app.use(errorHandler);

// ==============================================
// Bootstrap: ensure system OAuth client exists
// ==============================================
async function ensureSystemClient(): Promise<void> {
  try {
    await prisma.oAuthClient.upsert({
      where: { clientId: 'system-internal' },
      update: {},
      create: {
        clientId: 'system-internal',
        clientSecret: 'system-internal-not-used',
        name: 'System Internal Client',
        redirectUris: [],
        grants: [],
        scopes: ['profile', 'email', 'internal', 'government'],
        isActive: true,
      },
    });
    logger.info('System OAuth client ready');
  } catch (error) {
    logger.error('Failed to ensure system client', { error });
  }
}

// ==============================================
// Token cleanup scheduler (every 1 hour)
// ==============================================
function startTokenCleanup(): void {
  const interval = parseInt(process.env['TOKEN_CLEANUP_INTERVAL_MS'] ?? '3600000', 10);
  setInterval(async () => {
    try {
      const count = await tokenService.cleanupExpiredTokens();
      if (count > 0) {
        logger.info(`Cleaned up ${count} expired tokens`);
      }
    } catch (error) {
      logger.error('Token cleanup failed', { error });
    }
  }, interval);
  logger.info(`Token cleanup scheduled every ${interval}ms`);
}

// ==============================================
// Graceful shutdown
// ==============================================
async function shutdown(): Promise<void> {
  logger.info('Shutting down auth-service...');
  await disconnectAllDatabases();
  await disconnectRedis();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ==============================================
// Jaring pengaman
// ==============================================
// Sejak Node 15, unhandled rejection mematikan proses. Untuk server otentikasi
// yang dipakai seluruh instansi, itu berarti satu permintaan cacat pada satu
// rute bisa memadamkan login semua orang — persis yang terjadi lewat adminGuard
// pada 2026-08-27 (7 restart dalam sehari).
//
// Sebuah promise yang gagal ditangani adalah bug yang harus diperbaiki, tapi
// tempat memperbaikinya adalah kode rutenya, bukan dengan menjatuhkan layanan.
// Dicatat dengan keras supaya tidak diam-diam menumpuk.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection — service dipertahankan hidup', {
    reason: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Exception yang tak tertangkap meninggalkan proses dalam keadaan tak menentu,
// jadi di sini kita tetap keluar — tapi setelah alasannya tercatat. Sebelumnya
// prosesnya mati tanpa jejak apa pun di log.
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception — proses dihentikan', {
    error: error.message,
    stack: error.stack,
  });
  setTimeout(() => process.exit(1), 100);
});

// ==============================================
// Start server
// ==============================================
async function start(): Promise<void> {
  await connectRedis();
  await ensureSystemClient();

  app.listen(PORT, () => {
    logger.info(`Auth Service running on port ${PORT}`);
    logger.info(`Health check: http://localhost:${PORT}/health`);
  });

  startTokenCleanup();
}

start().catch((error) => {
  logger.error('Failed to start auth-service', { error });
  process.exit(1);
});

export { app };
