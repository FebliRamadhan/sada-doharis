import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as OTPAuth from 'otpauth';

// mfa.service only needs createLogger from @sada/shared. Loading the real package
// (winston) makes vitest's SSR module-fetch stall, so stub it — mirrors how the
// other service tests mock their heavy deps.
vi.mock('@sada/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Static import so the one-time esbuild transform of the service + otpauth happens
// during collection, not against a per-test timeout. MFA_SECRET_ENC_KEY is read at
// call-time (inside getEncKey), so stubbing it in beforeEach still takes effect.
import { mfaService } from '../services/mfa.service.js';

describe('mfaService', () => {
  beforeEach(() => {
    vi.stubEnv('MFA_SECRET_ENC_KEY', 'test-mfa-encryption-key-at-least-32chars');
    vi.stubEnv('NODE_ENV', 'test');
  });

  describe('generateSecret', () => {
    it('returns a base32 secret and an otpauth URI', () => {
      const { secret, uri } = mfaService.generateSecret('user@menpan.go.id');

      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(uri.startsWith('otpauth://totp/')).toBe(true);
      expect(uri).toContain('SADA');
    });
  });

  describe('verifyTotp', () => {
    it('accepts a freshly generated code and rejects invalid input', () => {
      const { secret } = mfaService.generateSecret('u@x');

      const totp = new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
      });

      expect(mfaService.verifyTotp(secret, totp.generate())).toBe(true);
      expect(mfaService.verifyTotp(secret, '000000')).toBe(false);
      expect(mfaService.verifyTotp(secret, 'abc')).toBe(false);
      expect(mfaService.verifyTotp(secret, '')).toBe(false);
    });

    it('tolerates one period of clock skew (window ±1)', () => {
      const { secret } = mfaService.generateSecret('u@x');
      const totp = new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
      });

      const prevCode = totp.generate({ timestamp: Date.now() - 30_000 });
      expect(mfaService.verifyTotp(secret, prevCode)).toBe(true);
    });
  });

  describe('backup codes', () => {
    // 10 bcrypt hashes at 12 rounds (pure-JS bcryptjs) is genuinely slow.
    it('generates 10 hashed codes that verify exactly once', async () => {
      const { plain, hashes } = await mfaService.generateBackupCodes();

      expect(plain).toHaveLength(10);
      expect(hashes).toHaveLength(10);
      expect(hashes[0]).not.toEqual(plain[0]);

      const idx = await mfaService.verifyBackupCode(hashes, plain[3]!);
      expect(idx).toBe(3);

      const idxLower = await mfaService.verifyBackupCode(hashes, plain[5]!.toLowerCase());
      expect(idxLower).toBe(5);

      const miss = await mfaService.verifyBackupCode(hashes, 'ZZZZZ-ZZZZZ');
      expect(miss).toBe(-1);
    }, 30000);
  });

  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret and never stores it in plaintext', () => {
      const { secret } = mfaService.generateSecret('u@x');

      const enc = mfaService.encryptSecret(secret);
      expect(enc).not.toContain(secret);
      expect(enc.split(':')).toHaveLength(3);
      expect(mfaService.decryptSecret(enc)).toBe(secret);
    });

    it('rejects a tampered ciphertext', () => {
      const enc = mfaService.encryptSecret('JBSWY3DPEHPK3PXP');
      const [iv, tag, cipher] = enc.split(':');
      const tampered = `${iv}:${tag}:${cipher!.slice(0, -2)}00`;
      expect(() => mfaService.decryptSecret(tampered)).toThrow();
    });
  });
});
