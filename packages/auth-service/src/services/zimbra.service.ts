import {
  AppError,
  ErrorCodes,
  ValidationError,
  createLogger,
  type LdapDirectory,
} from '@sada/shared';

const logger = createLogger('zimbra-service');

const TIMEOUT_MS = 10_000;

/** Tiap Direktori punya server Zimbra sendiri (docs/adr/0004). */
function soapUrl(directory: LdapDirectory = 'PRIMARY'): string | undefined {
  const key = directory === 'PRIMARY' ? 'ZIMBRA_SOAP_URL' : 'ZIMBRA2_SOAP_URL';
  return process.env[key]?.trim() || undefined;
}

/**
 * Pesan untuk kode fault Zimbra yang bisa diperbaiki user. Field menunjuk ke
 * isian form yang salah supaya UI bisa menempelkan pesan di tempatnya.
 */
const FAULTS: Record<string, { field: 'old_password' | 'new_password'; message: string }> = {
  'account.AUTH_FAILED': { field: 'old_password', message: 'Password lama salah.' },
  'account.PASSWORD_RECENTLY_USED': {
    field: 'new_password',
    message: 'Password ini sudah pernah Anda pakai. Pilih password lain.',
  },
  'account.PASSWORD_CHANGE_TOO_SOON': {
    field: 'new_password',
    message: 'Password baru saja diganti. Coba lagi nanti.',
  },
  'account.INVALID_PASSWORD': {
    field: 'new_password',
    message: 'Password ditolak oleh kebijakan password email kantor.',
  },
};

interface ZimbraFault {
  code?: string;
  reason?: string;
}

function readFault(body: unknown): ZimbraFault | null {
  const fault = (body as { Body?: { Fault?: Record<string, unknown> } })?.Body?.Fault;
  if (!fault) return null;
  const detail = fault['Detail'] as { Error?: { Code?: string } } | undefined;
  const reason = fault['Reason'] as { Text?: string } | undefined;
  return { code: detail?.Error?.Code, reason: reason?.Text };
}

/**
 * Akses Zimbra lewat SOAP (JSON). Lihat docs/adr/0002: password diganti oleh
 * user sendiri dengan password lamanya, persis seperti dari webmail — tidak
 * ada token admin di sini.
 */
export const zimbraService = {
  isConfigured(directory: LdapDirectory = 'PRIMARY'): boolean {
    return Boolean(soapUrl(directory));
  },

  /**
   * ChangePasswordRequest. Melempar ValidationError (field old_password /
   * new_password) untuk penolakan yang bisa diperbaiki user, dan AppError 503
   * bila Zimbra tidak bisa dihubungi. `directory` memilih server Zimbra milik
   * direktori user.
   */
  async changePassword(
    account: string,
    oldPassword: string,
    newPassword: string,
    directory: LdapDirectory = 'PRIMARY'
  ): Promise<void> {
    const url = soapUrl(directory);
    if (!url) {
      throw new AppError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Ganti password belum dikonfigurasi.',
        503
      );
    }

    const payload = {
      Header: { context: { _jsns: 'urn:zimbra' } },
      Body: {
        ChangePasswordRequest: {
          _jsns: 'urn:zimbraAccount',
          account: { by: 'name', _content: account },
          oldPassword: { _content: oldPassword },
          password: { _content: newPassword },
        },
      },
    };

    let body: unknown;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      body = await res.json().catch(() => null);
      if (
        res.ok &&
        (body as { Body?: Record<string, unknown> })?.Body?.['ChangePasswordResponse']
      ) {
        logger.info('Password changed via Zimbra', { account, directory });
        return;
      }
    } catch (error) {
      logger.error('Zimbra unreachable', { account, error: (error as Error).message });
      throw new AppError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Server email kantor tidak dapat dihubungi. Coba lagi beberapa saat lagi.',
        503
      );
    }

    const fault = readFault(body);
    const known = fault?.code ? FAULTS[fault.code] : undefined;
    // Reason Zimbra boleh dicatat, tetapi tidak dikirim mentah ke user.
    logger.warn('Zimbra rejected password change', {
      account,
      code: fault?.code,
      reason: fault?.reason,
    });
    if (known) {
      throw new ValidationError(known.message, { [known.field]: [known.message] });
    }
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      'Password tidak dapat diganti saat ini. Hubungi helpdesk bila berulang.',
      503
    );
  },
};

/** Parse LDAP GeneralizedTime (mis. 20260412083015Z atau 20260412083015.123Z). */
export function parseGeneralizedTime(value: string | undefined): Date | null {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[.,]\d+)?Z$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
  return Number.isNaN(date.getTime()) ? null : date;
}
