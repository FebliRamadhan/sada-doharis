import { createLogger } from '@sada/shared';

const logger = createLogger('gateway-env');
const IS_PROD = process.env['NODE_ENV'] === 'production';

const REQUIRED = [
  { name: 'REDIS_URL', desc: 'Redis connection string' },
  { name: 'AUTH_SERVICE_URL', desc: 'Auth service base URL for proxying & JWKS' },
];

export function validateEnv(): void {
  const errors: string[] = [];
  for (const { name, desc } of REQUIRED) {
    if (!process.env[name]) errors.push(`${name} is not set — ${desc}`);
  }

  if (IS_PROD && !process.env['CORS_ORIGIN']) {
    errors.push('CORS_ORIGIN must be set in production (no permissive fallback)');
  }

  if (errors.length > 0) {
    for (const e of errors) logger.error(e);
    throw new Error(`Gateway environment validation failed (${errors.length} errors)`);
  }
  logger.info('Gateway environment validated');
}
