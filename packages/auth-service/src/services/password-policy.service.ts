import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createLogger } from '@sada/shared';

const logger = createLogger('password-policy');

/**
 * Syarat minimum password baru dari SADA. Zimbra tetap memeriksa ulang dengan
 * kebijakan COS-nya sendiri (history, minimum age) — ini hanya lantai yang
 * dijamin apa pun konfigurasi direktorinya.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Daftar password bocor, disimpan lokal (tanpa API eksternal). Hanya entri
 * >= 12 karakter yang disimpan karena yang lebih pendek sudah ditolak oleh
 * syarat panjang. Dibandingkan dalam huruf kecil.
 * Sumber: SecLists Pwdb_top-1000000 + NCSC 100k.
 */
const LEAKED_LIST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/leaked-passwords.txt'
);

let leaked: Set<string> | null = null;
function leakedPasswords(): Set<string> {
  if (!leaked) {
    try {
      leaked = new Set(
        readFileSync(LEAKED_LIST_PATH, 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      );
    } catch (error) {
      logger.error('Leaked password list unavailable', { error: (error as Error).message });
      leaked = new Set();
    }
  }
  return leaked;
}

function characterClasses(pw: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length;
}

/** Potongan identitas user (>= 3 huruf) yang tidak boleh muncul di password. */
function identityParts(identity: { email?: string; name?: string; username?: string }): string[] {
  const parts = [
    identity.username,
    identity.email?.split('@')[0],
    ...(identity.email?.split('@')[0]?.split(/[._-]+/) ?? []),
    ...(identity.name?.split(/\s+/) ?? []),
  ];
  return [
    ...new Set(
      parts
        .map((p) => p?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '')
        .filter((p) => p.length >= 3)
    ),
  ];
}

/**
 * Kembalikan daftar alasan penolakan (bahasa Indonesia, siap ditampilkan).
 * Kosong berarti lolos syarat SADA.
 */
export function checkNewPassword(
  newPassword: string,
  ctx: { oldPassword?: string; email?: string; name?: string; username?: string }
): string[] {
  const errors: string[] = [];

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  }
  if (characterClasses(newPassword) < 3) {
    errors.push('Gunakan minimal 3 dari 4 jenis: huruf kecil, huruf besar, angka, simbol.');
  }
  if (ctx.oldPassword !== undefined && newPassword === ctx.oldPassword) {
    errors.push('Password baru harus berbeda dari password lama.');
  }
  const lower = newPassword.toLowerCase();
  if (identityParts(ctx).some((part) => lower.includes(part))) {
    errors.push('Password tidak boleh memuat nama atau username Anda.');
  }
  if (leakedPasswords().has(lower)) {
    errors.push('Password ini ada dalam daftar password yang pernah bocor. Pilih yang lain.');
  }

  return errors;
}
