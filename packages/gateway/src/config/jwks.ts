import crypto from 'crypto';
import { createLogger } from '@sada/shared';

const logger = createLogger('jwks');
const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:3001';

interface CachedKey {
    kid: string;
    key: crypto.KeyObject;
}

let cachedKeys: CachedKey[] = [];
let lastFetch = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchJWKS(): Promise<void> {
    try {
        const response = await fetch(`${AUTH_SERVICE_URL}/.well-known/jwks.json`);
        if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);

        const jwks = await response.json() as { keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string }> };
        cachedKeys = jwks.keys.map((jwk) => ({
            kid: jwk.kid,
            key: crypto.createPublicKey({ key: jwk, format: 'jwk' }),
        }));
        lastFetch = Date.now();
        logger.info('JWKS fetched and cached', { keyCount: cachedKeys.length });
    } catch (error) {
        logger.error('Failed to fetch JWKS', { error: (error as Error).message });
        throw error;
    }
}

export async function getVerificationKey(kid?: string): Promise<crypto.KeyObject> {
    // Refresh cache if stale
    if (Date.now() - lastFetch > CACHE_TTL_MS || cachedKeys.length === 0) {
        await fetchJWKS();
    }

    if (kid) {
        const found = cachedKeys.find((k) => k.kid === kid);
        if (found) return found.key;
    }

    // Fallback: return first key
    if (cachedKeys[0]) return cachedKeys[0].key;

    throw new Error('No verification keys available');
}
