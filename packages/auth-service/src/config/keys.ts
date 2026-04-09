import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
        } catch {
            logger.warn('RSA keys not found, generating and saving to configured paths', { privatePath });
        }
    }

    // Generate new key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    } as crypto.RSAKeyPairOptions<'pem', 'pem'>);

    // Persist to disk if paths are configured (survives container restarts)
    if (privatePath && publicPath) {
        try {
            fs.mkdirSync(path.dirname(privatePath), { recursive: true });
            fs.writeFileSync(privatePath, privateKey as unknown as string, { mode: 0o600 });
            fs.writeFileSync(publicPath, publicKey as unknown as string);
            logger.info('RSA keys generated and saved', { privatePath, publicPath, kid });
        } catch (writeErr) {
            logger.error('Failed to save RSA keys — keys are ephemeral this session', {
                error: (writeErr as Error).message,
            });
        }
    } else {
        logger.warn('RSA_PRIVATE_KEY_PATH not set — keys are ephemeral, set path for production');
    }

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
