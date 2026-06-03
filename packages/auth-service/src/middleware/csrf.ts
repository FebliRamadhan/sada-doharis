import type { Request, Response, NextFunction } from 'express';
import { createLogger, sendError, ErrorCodes } from '@sada/shared';
import { parseAllowedOrigins, isOriginAllowed } from '../utils/origin.js';

const logger = createLogger('csrf');

const allowedOrigins = parseAllowedOrigins(process.env['CORS_ORIGIN'], [
  'http://localhost:3000',
  'http://localhost:3002',
]);

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * CSRF protection by Origin / Referer validation.
 *
 * Modern browsers always send `Origin` on cross-site state-changing requests
 * and never expose it to attacker scripts. Combined with SameSite=lax session
 * cookies, this is sufficient CSRF defense for an SPA → auth-service setup.
 *
 * Use this on any endpoint that performs a state change via cookie-authenticated
 * requests (login, logout, consent approval, register).
 */
export function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  // Skip pure server-to-server calls — those use client_secret / Bearer JWT
  // and don't rely on cookies, so CSRF doesn't apply.
  const hasCookie = Boolean(req.headers.cookie);
  if (!hasCookie) {
    next();
    return;
  }

  const origin = req.headers.origin ?? (req.headers.referer ? originOf(req.headers.referer) : null);

  if (!origin) {
    logger.warn('CSRF block: no Origin/Referer on cookie-bearing state change', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    sendError(res, ErrorCodes.FORBIDDEN, 'Origin header required', 403);
    return;
  }

  if (!isOriginAllowed(origin, allowedOrigins)) {
    logger.warn('CSRF block: origin not in CORS allow-list', { origin, path: req.path });
    sendError(res, ErrorCodes.FORBIDDEN, 'Origin not allowed', 403);
    return;
  }

  next();
}
