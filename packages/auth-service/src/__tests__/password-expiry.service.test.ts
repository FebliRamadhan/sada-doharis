import { describe, expect, it } from 'vitest';
import {
  getPasswordExpiry,
  passwordStatusWhere,
  type PasswordExpiryConfig,
} from '../services/password-expiry.service.js';

/**
 * Masa Berlaku Password (CONTEXT.md): 90 hari sejak perubahan terakhir,
 * peringatan mulai hari ke-76, tanpa masa tenggang. Tanggal go-live adalah
 * titik awal hitungan minimum — tidak ada yang terblokir di hari go-live.
 */
const DAY = 86_400_000;
const START = new Date('2026-11-01T00:00:00Z');
const cfg: PasswordExpiryConfig = { start: START, maxAgeDays: 90, warningDays: 14 };
const at = (days: number) => new Date(START.getTime() + days * DAY);
const internal = (changed: Date | null, mustChange = false) => ({
  userType: 'INTERNAL',
  passwordChangedAt: changed,
  passwordMustChange: mustChange,
});

describe('getPasswordExpiry', () => {
  it('tidak berlaku selama tanggal go-live belum diisi', () => {
    const info = getPasswordExpiry(internal(null, true), at(500), { ...cfg, start: null });
    expect(info).toEqual({ status: 'ok', daysLeft: null, expiresAt: null });
  });

  it('tidak berlaku bagi user non-INTERNAL', () => {
    const info = getPasswordExpiry(
      { userType: 'GOVERNMENT', passwordMustChange: true },
      at(500),
      cfg
    );
    expect(info.status).toBe('ok');
    expect(info.daysLeft).toBeNull();
  });

  it('user tanpa tanggal mulai dihitung dari go-live', () => {
    expect(getPasswordExpiry(internal(null), at(0), cfg)).toMatchObject({
      status: 'ok',
      daysLeft: 90,
    });
    expect(getPasswordExpiry(internal(null), at(89.9), cfg).status).toBe('warning');
    expect(getPasswordExpiry(internal(null), at(90), cfg).status).toBe('expired');
  });

  it('password lama sebelum go-live tidak langsung memblokir di hari go-live', () => {
    const twoYearsAgo = new Date(START.getTime() - 730 * DAY);
    expect(getPasswordExpiry(internal(twoYearsAgo), at(0), cfg).status).toBe('ok');
  });

  it('peringatan mulai hari ke-76 (14 hari tersisa)', () => {
    const changed = at(10);
    expect(getPasswordExpiry(internal(changed), at(10 + 75), cfg)).toMatchObject({
      status: 'ok',
      daysLeft: 15,
    });
    expect(getPasswordExpiry(internal(changed), at(10 + 76), cfg)).toMatchObject({
      status: 'warning',
      daysLeft: 14,
    });
  });

  it('kedaluwarsa tepat di hari ke-90, tanpa masa tenggang', () => {
    expect(getPasswordExpiry(internal(at(10)), at(100), cfg)).toMatchObject({
      status: 'expired',
      daysLeft: 0,
    });
  });

  it('Wajibkan Ganti Password oleh admin langsung kedaluwarsa', () => {
    expect(getPasswordExpiry(internal(at(0), true), at(1), cfg).status).toBe('expired');
  });
});

describe('passwordStatusWhere', () => {
  it('fitur mati: tidak ada yang peringatan maupun kedaluwarsa', () => {
    const off = { ...cfg, start: null };
    expect(passwordStatusWhere('expired', at(500), off)).toEqual({ id: { in: [] } });
    expect(passwordStatusWhere('warning', at(500), off)).toEqual({ id: { in: [] } });
    expect(passwordStatusWhere('ok', at(500), off)).toEqual({});
  });

  it('sebelum 90 hari sejak go-live, hanya yang diwajibkan admin yang kedaluwarsa', () => {
    expect(passwordStatusWhere('expired', at(30), cfg)).toEqual({
      userType: 'INTERNAL',
      OR: [{ passwordMustChange: true }],
    });
  });

  it('setelah 90 hari, yang tanpa tanggal atau tanggalnya lewat batas ikut kedaluwarsa', () => {
    const where = passwordStatusWhere('expired', at(120), cfg) as { OR: unknown[] };
    expect(where.OR).toContainEqual({
      OR: [{ passwordChangedAt: null }, { passwordChangedAt: { lte: at(30) } }],
    });
  });

  it('peringatan tidak mencakup yang sudah kedaluwarsa atau diwajibkan admin', () => {
    const where = passwordStatusWhere('warning', at(120), cfg) as { AND: unknown[] };
    expect(where.AND[0]).toEqual({ userType: 'INTERNAL', passwordMustChange: false });
    expect(where.AND[2]).toEqual({
      NOT: { OR: [{ passwordChangedAt: null }, { passwordChangedAt: { lte: at(30) } }] },
    });
  });
});
