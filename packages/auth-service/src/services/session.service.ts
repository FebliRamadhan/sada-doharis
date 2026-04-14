import crypto from 'crypto';
import type { Request, Response, CookieOptions } from 'express';
import { getRedis } from '../config/redis.js';

export const SESSION_COOKIE_NAME = 'sada_sid';

const SESSION_TTL_SECONDS = parseTTL(process.env['SESSION_TTL'] ?? '7d');
const COOKIE_DOMAIN = process.env['SESSION_COOKIE_DOMAIN'];
const IS_PROD = process.env['NODE_ENV'] === 'production';

function parseTTL(value: string): number {
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 86400;
    const n = parseInt(match[1]!, 10);
    switch (match[2]) {
        case 's': return n;
        case 'm': return n * 60;
        case 'h': return n * 3600;
        case 'd': return n * 86400;
        default: return 7 * 86400;
    }
}

function sessionKey(sid: string): string {
    return `session:${sid}`;
}

function cookieOptions(): CookieOptions {
    const opts: CookieOptions = {
        httpOnly: true,
        // Lax allows the cookie to be sent on top-level cross-site navigations
        // (which is what app1 → /oauth/authorize redirects look like) and
        // same-site XHR/fetch from the auth-ui.
        sameSite: 'lax',
        secure: IS_PROD,
        path: '/',
        maxAge: SESSION_TTL_SECONDS * 1000,
        signed: true,
    };
    if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
    return opts;
}

export const sessionService = {
    /**
     * Create a new SSO session in Redis and set the cookie on the response.
     */
    async create(res: Response, userId: string): Promise<string> {
        const sid = crypto.randomBytes(32).toString('hex');
        const redis = getRedis();
        await redis.setex(sessionKey(sid), SESSION_TTL_SECONDS, userId);
        res.cookie(SESSION_COOKIE_NAME, sid, cookieOptions());
        return sid;
    },

    /**
     * Read the user id from the signed cookie, validating against Redis.
     * Returns null when the cookie is missing, tampered, or expired.
     */
    async getUserId(req: Request): Promise<string | null> {
        const sid = req.signedCookies?.[SESSION_COOKIE_NAME];
        if (!sid || typeof sid !== 'string') return null;
        const userId = await getRedis().get(sessionKey(sid));
        return userId ?? null;
    },

    /**
     * Destroy the session in Redis and clear the cookie.
     */
    async destroy(req: Request, res: Response): Promise<void> {
        const sid = req.signedCookies?.[SESSION_COOKIE_NAME];
        if (sid && typeof sid === 'string') {
            await getRedis().del(sessionKey(sid));
        }
        const clearOpts: CookieOptions = { path: '/' };
        if (COOKIE_DOMAIN) clearOpts.domain = COOKIE_DOMAIN;
        res.clearCookie(SESSION_COOKIE_NAME, clearOpts);
    },

    /**
     * Destroy every session belonging to a given user (e.g. on global logout).
     */
    async destroyAllForUser(userId: string): Promise<void> {
        const redis = getRedis();
        const stream = redis.scanStream({ match: 'session:*', count: 100 });
        const toDelete: string[] = [];
        for await (const keys of stream) {
            const arr = keys as string[];
            if (arr.length === 0) continue;
            const values = await redis.mget(...arr);
            arr.forEach((key, idx) => {
                if (values[idx] === userId) toDelete.push(key);
            });
        }
        if (toDelete.length > 0) {
            await redis.del(...toDelete);
        }
    },
};
