import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LDAP sekunder (docs/adr/0004): secondary hanya dicoba bila primary TIDAK
 * menemukan user. Password salah dan primary tak terjangkau langsung gagal.
 *
 * Mock ldapjs dikendalikan per URL: tiap direktori punya perilaku sendiri.
 */
type Behaviour = 'found' | 'not_found' | 'wrong_password' | 'bind_fails' | 'connection_error';

const behaviours = vi.hoisted(() => new Map<string, Behaviour>());
const createdFor = vi.hoisted(() => [] as string[]);

vi.mock('ldapjs', () => ({
  default: {
    createClient: vi.fn(({ url }: { url: string }) => {
      createdFor.push(url);
      const b = behaviours.get(url) ?? 'not_found';
      let binds = 0;
      return {
        on: (event: string, cb: (err: Error) => void) => {
          if (event === 'error' && b === 'connection_error') {
            process.nextTick(() => cb(new Error('ECONNREFUSED')));
          }
        },
        destroy: vi.fn(),
        bind: (_dn: string, _pw: string, cb: (err: Error | null) => void) => {
          if (b === 'connection_error') return;
          binds += 1;
          if (binds === 1) return cb(b === 'bind_fails' ? new Error('bind') : null);
          cb(b === 'wrong_password' ? new Error('Invalid credentials') : null);
        },
        search: (
          _base: string,
          _opts: unknown,
          cb: (err: Error | null, res: EventEmitter) => void
        ) => {
          const res = new EventEmitter();
          cb(null, res);
          process.nextTick(() => {
            if (b !== 'not_found') {
              res.emit('searchEntry', {
                dn: { toString: () => `uid=budi,ou=people,dc=menpan,dc=go,dc=id` },
                object: { uid: 'budi', cn: 'Budi', mail: 'budi@menpan.go.id' },
              });
            }
            res.emit('end');
          });
        },
      };
    }),
  },
}));

vi.mock('@sada/shared', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const PRIMARY = 'ldap://primary:389';
const SECONDARY = 'ldap://secondary:389';

beforeEach(() => {
  behaviours.clear();
  createdFor.length = 0;
  vi.stubEnv('LDAP_URL', PRIMARY);
  vi.stubEnv('LDAP_BIND_DN', 'uid=zimbra,cn=admins,cn=zimbra');
  vi.stubEnv('LDAP_SEARCH_BASE', 'dc=menpan,dc=go,dc=id');
  vi.stubEnv('LDAP2_URL', SECONDARY);
  vi.stubEnv('LDAP2_BIND_DN', 'uid=zimbra,cn=admins,cn=zimbra');
  vi.stubEnv('LDAP2_SEARCH_BASE', 'dc=menpan,dc=go,dc=id');
});

afterEach(() => vi.unstubAllEnvs());

async function service() {
  return import('../services/ldap.service.js');
}

describe('ldapService.authenticateAny', () => {
  it('memakai primary bila user ada di sana, tanpa menyentuh secondary', async () => {
    behaviours.set(PRIMARY, 'found');
    const { ldapService } = await service();
    const u = await ldapService.authenticateAny('budi', 'rahasia');
    expect(u.directory).toBe('PRIMARY');
    expect(createdFor).toEqual([PRIMARY]);
  });

  it('beralih ke secondary hanya bila primary tidak menemukan user', async () => {
    behaviours.set(PRIMARY, 'not_found');
    behaviours.set(SECONDARY, 'found');
    const { ldapService } = await service();
    const u = await ldapService.authenticateAny('budi', 'rahasia');
    expect(u.directory).toBe('SECONDARY');
    expect(createdFor).toEqual([PRIMARY, SECONDARY]);
  });

  it('password salah di primary tidak dicoba ke secondary', async () => {
    behaviours.set(PRIMARY, 'wrong_password');
    behaviours.set(SECONDARY, 'found');
    const { ldapService } = await service();
    await expect(ldapService.authenticateAny('budi', 'salah')).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
    expect(createdFor).toEqual([PRIMARY]);
  });

  it('primary gagal bind admin: gagal tertutup, secondary tidak dicoba', async () => {
    behaviours.set(PRIMARY, 'bind_fails');
    behaviours.set(SECONDARY, 'found');
    const { ldapService } = await service();
    await expect(ldapService.authenticateAny('budi', 'rahasia')).rejects.toMatchObject({
      failure: 'unavailable',
    });
    expect(createdFor).toEqual([PRIMARY]);
  });

  it('primary tak terjangkau: gagal tertutup, secondary tidak dicoba', async () => {
    behaviours.set(PRIMARY, 'connection_error');
    behaviours.set(SECONDARY, 'found');
    const { ldapService } = await service();
    await expect(ldapService.authenticateAny('budi', 'rahasia')).rejects.toMatchObject({
      failure: 'unavailable',
    });
    expect(createdFor).toEqual([PRIMARY]);
  });

  it('secondary kosong di env: tidak ditemukan tetap tidak ditemukan', async () => {
    vi.stubEnv('LDAP2_URL', '');
    behaviours.set(PRIMARY, 'not_found');
    const { ldapService } = await service();
    expect(ldapService.isSecondaryConfigured()).toBe(false);
    await expect(ldapService.authenticateAny('budi', 'rahasia')).rejects.toMatchObject({
      failure: 'not_found',
    });
    expect(createdFor).toEqual([PRIMARY]);
  });
});
