import { describe, expect, it } from 'vitest';
import { checkNewPassword } from '../services/password-policy.service.js';
import { parseGeneralizedTime } from '../services/zimbra.service.js';

const ctx = {
  oldPassword: 'Lama#Sekali2025',
  email: 'budi.santoso@menpan.go.id',
  name: 'Budi Santoso',
};

describe('checkNewPassword', () => {
  it('menerima password kuat yang tidak memuat identitas', () => {
    expect(checkNewPassword('Kopi-Pagi#Rabu42', ctx)).toEqual([]);
  });

  it('menolak di bawah 12 karakter', () => {
    expect(checkNewPassword('Kp#9xQwe', ctx).join(' ')).toContain('Minimal 12');
  });

  it('mensyaratkan 3 dari 4 jenis karakter', () => {
    expect(checkNewPassword('hurufkecilsemuasaja', ctx).join(' ')).toContain('3 dari 4');
    expect(checkNewPassword('hurufkecil1234567', ctx).join(' ')).toContain('3 dari 4');
    expect(checkNewPassword('Hurufkecil1234567', ctx)).toEqual([]);
  });

  it('menolak password yang sama dengan yang lama', () => {
    expect(checkNewPassword(ctx.oldPassword, ctx).join(' ')).toContain('berbeda');
  });

  it('menolak password yang memuat nama atau username', () => {
    expect(checkNewPassword('Santoso#2026Ok', ctx).join(' ')).toContain('nama atau username');
    expect(checkNewPassword('X9!budi.santoso', ctx).join(' ')).toContain('nama atau username');
  });

  it('menolak password dari daftar bocor tanpa peduli huruf besar/kecil', () => {
    // "Password123!" ada di daftar bocor dan lolos syarat lainnya
    expect(checkNewPassword('PASSWORD123!', { email: 'x@y.z' }).join(' ')).toContain('bocor');
  });
});

describe('parseGeneralizedTime', () => {
  it('membaca format zimbraPasswordModifiedTime', () => {
    expect(parseGeneralizedTime('20260412083015Z')?.toISOString()).toBe('2026-04-12T08:30:15.000Z');
    expect(parseGeneralizedTime('20260412083015.123Z')?.toISOString()).toBe(
      '2026-04-12T08:30:15.000Z'
    );
  });

  it('mengembalikan null untuk nilai kosong atau rusak', () => {
    expect(parseGeneralizedTime(undefined)).toBeNull();
    expect(parseGeneralizedTime('kemarin')).toBeNull();
  });
});
