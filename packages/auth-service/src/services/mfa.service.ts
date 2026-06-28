import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import { createLogger } from '@sada/shared';

const logger = createLogger('mfa-service');

const MFA_ISSUER = process.env['MFA_ISSUER'] ?? 'SADA SSO';
const SALT_ROUNDS = 12;
const BACKUP_CODE_COUNT = 10;

// AES-256-GCM key derivation. The TOTP secret is sensitive, so it is encrypted
// at rest. In production MFA_SECRET_ENC_KEY must be set; in dev we fall back to a
// key derived from JWT_SECRET so local flows still work.
function getEncKey(): Buffer {
  const raw = process.env['MFA_SECRET_ENC_KEY'] ?? process.env['JWT_SECRET'];
  if (!raw) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('FATAL: MFA_SECRET_ENC_KEY must be set in production');
    }
    logger.warn('MFA_SECRET_ENC_KEY not set — using insecure dev fallback');
    return crypto.createHash('sha256').update('mfa-dev-fallback-key').digest();
  }
  // Normalize any-length input to a 32-byte key.
  return crypto.createHash('sha256').update(raw).digest();
}

function buildTotp(secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: MFA_ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export const mfaService = {
  /**
   * Generate a fresh TOTP secret + otpauth:// provisioning URI for enrollment.
   */
  generateSecret(email: string): { secret: string; uri: string } {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: MFA_ISSUER,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    return { secret: secret.base32, uri: totp.toString() };
  },

  /**
   * Render an otpauth URI as a PNG data-URL so the SPA can show a QR code.
   */
  async buildQrDataUrl(uri: string): Promise<string> {
    // Lazy import: qrcode is a heavy module only needed during enrollment, so we
    // keep it out of the module load graph (faster service import + tests).
    const { default: QRCode } = await import('qrcode');
    return QRCode.toDataURL(uri, { margin: 1, width: 220 });
  },

  /**
   * Verify a 6-digit TOTP code against a base32 secret. window ±1 tolerates clock skew.
   */
  verifyTotp(secretBase32: string, code: string): boolean {
    const normalized = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalized)) return false;
    const delta = buildTotp(secretBase32).validate({ token: normalized, window: 1 });
    return delta !== null;
  },

  /**
   * Generate one-time backup recovery codes. Returns plaintext (shown once) and
   * bcrypt hashes (persisted on the user).
   */
  async generateBackupCodes(): Promise<{ plain: string[]; hashes: string[] }> {
    const plain: string[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      // 10 hex chars grouped as XXXXX-XXXXX for readability.
      const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
      plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    }
    const hashes = await Promise.all(plain.map((c) => bcrypt.hash(c, SALT_ROUNDS)));
    return { plain, hashes };
  },

  /**
   * Check a backup code against the stored hashes. Returns the matching hash
   * index (so the caller can consume it) or -1 when none match.
   */
  async verifyBackupCode(hashes: string[], code: string): Promise<number> {
    const normalized = code.trim().toUpperCase();
    for (let i = 0; i < hashes.length; i++) {
      if (await bcrypt.compare(normalized, hashes[i]!)) return i;
    }
    return -1;
  },

  /**
   * Encrypt a TOTP secret for storage. Format: ivHex:authTagHex:cipherHex.
   */
  encryptSecret(secretBase32: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncKey(), iv);
    const enc = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  },

  /**
   * Decrypt a stored TOTP secret produced by encryptSecret().
   */
  decryptSecret(stored: string): string {
    const [ivHex, tagHex, cipherHex] = stored.split(':');
    if (!ivHex || !tagHex || !cipherHex) {
      throw new Error('Malformed encrypted MFA secret');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncKey(),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  },
};
