import crypto from 'crypto';
import fs from 'fs';
import { createLogger } from '@sada/shared';
import type { JWK, JWKSResponse } from '@sada/shared';

const logger = createLogger('keys');

interface KeyPair {
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
    kid: string;
}

let keyPair: KeyPair | null = null;

function loadOrGenerateKeys(): KeyPair {
    const kid = process.env['RSA_KEY_ID'] ?? 'key-1';
    const privatePath = process.env['RSA_PRIVATE_KEY_PATH'];
    const publicPath = process.env['RSA_PUBLIC_KEY_PATH'];

    if (privatePath && publicPath) {
        try {
            const privatePem = fs.readFileSync(privatePath, 'utf8');
            const publicPem = fs.readFileSync(publicPath, 'utf8');
            logger.info('RSA keys loaded from filesystem', { kid });
            return {
                privateKey: crypto.createPrivateKey(privatePem),
                publicKey: crypto.createPublicKey(publicPem),
                kid,
            };
        } catch (err) {
            if (process.env['NODE_ENV'] === 'production') {
                throw new Error(`FATAL: Cannot load RSA keys from ${privatePath} / ${publicPath}: ${(err as Error).message}`);
            }
            logger.warn('RSA key files not found, auto-generating for dev', { privatePath });
        }
    }

    // Auto-generate for development
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    } as crypto.RSAKeyPairOptions<'pem', 'pem'>);

    logger.warn('Auto-generated RSA key pair (development only — set RSA_PRIVATE_KEY_PATH for production)');

    return {
        privateKey: crypto.createPrivateKey(privateKey as unknown as string),
        publicKey: crypto.createPublicKey(publicKey as unknown as string),
        kid,
    };
}

function getKeyPair(): KeyPair {
    if (!keyPair) {
        keyPair = loadOrGenerateKeys();
    }
    return keyPair;
}

export function getPrivateKey(): crypto.KeyObject {
    return getKeyPair().privateKey;
}

export function getPublicKey(): crypto.KeyObject {
    return getKeyPair().publicKey;
}

export function getKeyId(): string {
    return getKeyPair().kid;
}

export function getJWKS(): JWKSResponse {
    const { publicKey, kid } = getKeyPair();
    const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string; kty: string };

    const key: JWK = {
        kty: jwk.kty,
        use: 'sig',
        kid,
        alg: 'RS256',
        n: jwk.n,
        e: jwk.e,
    };

    return { keys: [key] };
}
