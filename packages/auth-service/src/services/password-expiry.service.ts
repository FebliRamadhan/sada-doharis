/**
 * Masa Berlaku Password LDAP (lihat CONTEXT.md dan docs/adr/0002).
 *
 * Hanya berlaku bagi user INTERNAL. Perubahan terakhir yang diketahui adalah
 * yang paling akhir dari `zimbraPasswordModifiedTime` (disalin ke
 * `User.passwordChangedAt` setiap login) dan perubahan lewat SADA sendiri.
 *
 * PASSWORD_EXPIRY_START adalah tanggal go-live sekaligus saklar fitur: selama
 * tidak diisi, tidak ada yang kedaluwarsa. Tanggal itu juga menjadi titik awal
 * hitungan minimum bagi SEMUA user, sehingga pada hari go-live tidak ada yang
 * langsung terblokir — paling cepat 90 hari setelahnya.
 */

const DAY_MS = 86_400_000;

export type PasswordStatus = 'ok' | 'warning' | 'expired';

export interface PasswordExpiryConfig {
  start: Date | null;
  maxAgeDays: number;
  warningDays: number;
}

export interface PasswordExpiryInfo {
  status: PasswordStatus;
  /** Sisa hari sebelum kedaluwarsa; 0 bila sudah kedaluwarsa. null bila fitur tidak berlaku. */
  daysLeft: number | null;
  expiresAt: Date | null;
}

export interface PasswordExpirySubject {
  userType: string;
  passwordChangedAt?: Date | null;
  passwordMustChange?: boolean;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPasswordExpiryConfig(): PasswordExpiryConfig {
  const raw = process.env['PASSWORD_EXPIRY_START']?.trim();
  const start = raw ? new Date(raw) : null;
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    maxAgeDays: positiveInt(process.env['PASSWORD_MAX_AGE_DAYS'], 90),
    warningDays: positiveInt(process.env['PASSWORD_WARNING_DAYS'], 14),
  };
}

const NOT_APPLICABLE: PasswordExpiryInfo = { status: 'ok', daysLeft: null, expiresAt: null };

export function getPasswordExpiry(
  user: PasswordExpirySubject,
  now: Date = new Date(),
  config: PasswordExpiryConfig = getPasswordExpiryConfig()
): PasswordExpiryInfo {
  if (user.userType !== 'INTERNAL' || !config.start) return NOT_APPLICABLE;

  const changed = user.passwordChangedAt ?? null;
  const countFrom = changed && changed > config.start ? changed : config.start;
  const expiresAt = new Date(countFrom.getTime() + config.maxAgeDays * DAY_MS);

  if (user.passwordMustChange || now >= expiresAt) {
    return { status: 'expired', daysLeft: 0, expiresAt };
  }

  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
  return { status: daysLeft <= config.warningDays ? 'warning' : 'ok', daysLeft, expiresAt };
}

/**
 * Filter Prisma yang setara dengan status di atas, untuk daftar admin. Hanya
 * menyentuh user INTERNAL; status lain (bukan INTERNAL / fitur mati) tidak
 * pernah 'warning' atau 'expired'.
 */
export function passwordStatusWhere(
  status: PasswordStatus,
  now: Date = new Date(),
  config: PasswordExpiryConfig = getPasswordExpiryConfig()
): Record<string, unknown> {
  const none = { id: { in: [] as string[] } };
  if (!config.start) return status === 'ok' ? {} : none;

  // Kedaluwarsa bila titik awal hitungan <= expiredCutoff; peringatan bila <= warnCutoff.
  const expiredCutoff = new Date(now.getTime() - config.maxAgeDays * DAY_MS);
  const warnCutoff = new Date(now.getTime() - (config.maxAgeDays - config.warningDays) * DAY_MS);

  // max(passwordChangedAt, start) <= cutoff  ⇔  start <= cutoff ∧ (changedAt null ∨ changedAt <= cutoff)
  const countFromAtOrBefore = (cutoff: Date): Record<string, unknown> | null =>
    config.start! <= cutoff
      ? { OR: [{ passwordChangedAt: null }, { passwordChangedAt: { lte: cutoff } }] }
      : null;

  const expiredByAge = countFromAtOrBefore(expiredCutoff);
  const expired = {
    userType: 'INTERNAL',
    OR: [{ passwordMustChange: true }, ...(expiredByAge ? [expiredByAge] : [])],
  };

  if (status === 'expired') return expired;

  const warnByAge = countFromAtOrBefore(warnCutoff);
  if (status === 'warning') {
    return warnByAge
      ? {
          AND: [
            { userType: 'INTERNAL', passwordMustChange: false },
            warnByAge,
            { NOT: expiredByAge ?? none },
          ],
        }
      : none;
  }

  // ok: semua yang bukan peringatan maupun kedaluwarsa
  return {
    NOT: warnByAge ? { OR: [expired, { AND: [{ userType: 'INTERNAL' }, warnByAge] }] } : expired,
  };
}
