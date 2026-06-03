import { createLogger } from '@sada/shared';

const logger = createLogger('env');

const IS_PROD = process.env['NODE_ENV'] === 'production';

interface EnvCheck {
  name: string;
  required: boolean;
  minLength?: number;
  forbiddenValues?: string[];
  description?: string;
}

const CHECKS: EnvCheck[] = [
  { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string' },
  { name: 'REDIS_URL', required: true, description: 'Redis connection string' },
  {
    name: 'JWT_SECRET',
    required: true,
    minLength: 32,
    forbiddenValues: ['default-secret', 'your-super-secret-jwt-key-change-in-production'],
    description: 'JWT signing secret (used for cookies/fallback; must be a strong random value)',
  },
  {
    name: 'SESSION_COOKIE_SECRET',
    required: IS_PROD,
    minLength: 32,
    forbiddenValues: ['change-me-to-a-long-random-string', 'dev-cookie-secret'],
    description: 'Secret used to sign SSO session cookies',
  },
  {
    name: 'RSA_PRIVATE_KEY_PATH',
    required: IS_PROD,
    description: 'Path to RS256 private key (ephemeral keys are unsafe in production)',
  },
  {
    name: 'RSA_PUBLIC_KEY_PATH',
    required: IS_PROD,
    description: 'Path to RS256 public key',
  },
  {
    name: 'OIDC_ISSUER',
    required: IS_PROD,
    description: 'Public OIDC issuer URL (must match the tokens you sign)',
  },
];

export function validateEnv(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const check of CHECKS) {
    const value = process.env[check.name];

    if (!value) {
      const msg = `${check.name} is not set${check.description ? ` — ${check.description}` : ''}`;
      if (check.required) errors.push(msg);
      else warnings.push(msg);
      continue;
    }

    if (check.minLength && value.length < check.minLength) {
      const msg = `${check.name} is shorter than ${check.minLength} chars — weak secret`;
      if (check.required) errors.push(msg);
      else warnings.push(msg);
    }

    if (check.forbiddenValues?.includes(value)) {
      const msg = `${check.name} is using a default/placeholder value — must be changed`;
      if (check.required) errors.push(msg);
      else warnings.push(msg);
    }
  }

  for (const w of warnings) logger.warn(w);

  if (errors.length > 0) {
    for (const e of errors) logger.error(e);
    throw new Error(
      `Environment validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}). ` +
        `Fix the issues above before starting in ${IS_PROD ? 'production' : 'this'} mode.`
    );
  }

  logger.info('Environment validation passed', { mode: IS_PROD ? 'production' : 'development' });
}
