import ldap from 'ldapjs';
import { createLogger, UnauthorizedError, type LdapUser, type LdapDirectory } from '@sada/shared';
import { parseGeneralizedTime } from './zimbra.service.js';

const logger = createLogger('ldap-service');

interface DirectoryConfig {
  url: string;
  bindDn: string;
  bindPassword: string;
  searchBase: string;
  searchFilter: string;
}

/**
 * Dua direktori Zimbra (CONTEXT.md: Direktori). PRIMARY dari LDAP_*, SECONDARY
 * dari LDAP2_*. Dibaca saat dipanggil, bukan saat modul dimuat, supaya env yang
 * kosong benar-benar mematikan secondary.
 */
function directoryConfig(directory: LdapDirectory): DirectoryConfig {
  const p = directory === 'PRIMARY' ? 'LDAP_' : 'LDAP2_';
  return {
    url: process.env[`${p}URL`] ?? (directory === 'PRIMARY' ? 'ldap://localhost:389' : ''),
    bindDn: process.env[`${p}BIND_DN`] ?? '',
    bindPassword: process.env[`${p}BIND_PASSWORD`] ?? '',
    searchBase: process.env[`${p}SEARCH_BASE`] ?? '',
    searchFilter: process.env[`${p}SEARCH_FILTER`] || '(uid={{username}})',
  };
}

function isDirectoryConfigured(directory: LdapDirectory): boolean {
  const c = directoryConfig(directory);
  return !!(c.url && c.bindDn && c.searchBase);
}

export type LdapFailure = 'not_found' | 'invalid_credentials' | 'unavailable';

/**
 * Kegagalan LDAP yang tahu jenisnya. Hanya `not_found` yang boleh membuat
 * SADA mencoba direktori secondary (docs/adr/0004).
 */
export class LdapAuthError extends UnauthorizedError {
  constructor(
    public readonly failure: LdapFailure,
    message: string
  ) {
    super(message);
  }
}

/**
 * Escape special characters per RFC 4515 to prevent LDAP injection.
 * Characters: NUL, *, (, ), \
 */
function escapeLdapFilter(input: string): string {
  // NUL is a required LDAP filter special char (RFC 4515); the control-char rule is intentional here
  // eslint-disable-next-line no-control-regex
  const special = /[\x00*()\\]/g;
  return input.replace(special, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function authenticateIn(
  directory: LdapDirectory,
  username: string,
  password: string
): Promise<LdapUser> {
  const cfg = directoryConfig(directory);
  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url: cfg.url,
      timeout: 5000,
      connectTimeout: 10000,
    });

    client.on('error', (err) => {
      logger.error('LDAP connection error', { directory, error: err.message });
      reject(new LdapAuthError('unavailable', 'LDAP connection failed'));
    });

    client.bind(cfg.bindDn, cfg.bindPassword, (bindErr) => {
      if (bindErr) {
        logger.error('LDAP bind error', { directory, error: bindErr.message });
        client.destroy();
        reject(new LdapAuthError('unavailable', 'LDAP authentication failed'));
        return;
      }

      const searchFilter = cfg.searchFilter.replace('{{username}}', escapeLdapFilter(username));
      const searchOptions: ldap.SearchOptions = {
        filter: searchFilter,
        scope: 'sub',
        attributes: [
          'dn',
          'uid',
          'cn',
          'mail',
          'department',
          'title',
          'zimbraPasswordModifiedTime',
        ],
      };

      client.search(cfg.searchBase, searchOptions, (searchErr, res) => {
        if (searchErr) {
          logger.error('LDAP search error', { directory, error: searchErr.message });
          client.destroy();
          reject(new LdapAuthError('unavailable', 'LDAP search failed'));
          return;
        }

        let userEntry: ldap.SearchEntry | null = null;
        let settled = false;

        // Zimbra may send referral errors AFTER delivering the entry.
        // Use settled flag so only the first resolution wins.
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        res.on('searchEntry', (entry) => {
          userEntry = entry;
        });

        res.on('error', (err) => {
          if (userEntry) {
            // Entry already found — treat referral/size-limit errors as non-fatal
            logger.warn('LDAP referral/error ignored (entry already found)', {
              directory,
              error: err.message,
            });
            bindUser();
          } else {
            // Pencarian putus sebelum hasil lengkap: kita tidak tahu user ada
            // atau tidak, jadi ini bukan "tidak ditemukan" (gagal tertutup).
            logger.error('LDAP search result error', { directory, error: err.message });
            settle(() => {
              client.destroy();
              reject(new LdapAuthError('unavailable', 'LDAP search failed'));
            });
          }
        });

        res.on('end', () => {
          if (!userEntry) {
            settle(() => {
              client.destroy();
              reject(new LdapAuthError('not_found', 'User not found'));
            });
            return;
          }
          bindUser();
        });

        const bindUser = () => {
          if (!userEntry) return;
          const userDn = userEntry.dn.toString();

          settle(() => {
            client.bind(userDn, password, (authErr) => {
              client.destroy();

              if (authErr) {
                logger.warn('LDAP authentication failed', { directory, username });
                reject(new LdapAuthError('invalid_credentials', 'Invalid credentials'));
                return;
              }

              // ldapjs v3 tidak lagi punya `entry.object`; atributnya ada di
              // `entry.attributes` ({ type, values }). Tanpa ini mail/cn dan
              // zimbraPasswordModifiedTime selalu kosong. `object` tetap
              // didukung untuk entri gaya lama (dipakai mock di unit test).
              const getAttribute = (name: string): string | undefined => {
                const e = userEntry as unknown as {
                  object?: Record<string, unknown>;
                  attributes?: { type: string; values: unknown[] }[];
                };
                const fromAttributes = e.attributes?.find(
                  (a) => a.type.toLowerCase() === name.toLowerCase()
                )?.values?.[0];
                const attr = fromAttributes ?? e.object?.[name];
                if (Array.isArray(attr)) return attr.length ? String(attr[0]) : undefined;
                return attr ? String(attr) : undefined;
              };

              const ldapUser: LdapUser = {
                dn: userDn,
                uid: getAttribute('uid') ?? username,
                cn: getAttribute('cn') ?? username,
                mail: getAttribute('mail') ?? '',
                department: getAttribute('department'),
                title: getAttribute('title'),
                passwordChangedAt:
                  parseGeneralizedTime(getAttribute('zimbraPasswordModifiedTime')) ?? undefined,
                directory,
              };

              logger.info('LDAP authentication successful', { directory, username });
              resolve(ldapUser);
            });
          });
        };
      });
    });
  });
}

export const ldapService = {
  /**
   * Autentikasi di satu direktori (default PRIMARY). Melempar LdapAuthError
   * dengan `failure` not_found / invalid_credentials / unavailable.
   */
  authenticate(
    username: string,
    password: string,
    directory: LdapDirectory = 'PRIMARY'
  ): Promise<LdapUser> {
    return authenticateIn(directory, username, password);
  },

  /**
   * Primary dulu; secondary HANYA bila primary tidak punya user ini.
   * Password salah atau primary tak terjangkau langsung gagal — lihat
   * docs/adr/0004 untuk alasannya (username kembar, primary mati).
   * Hasilnya membawa `directory` tempat user ditemukan.
   */
  async authenticateAny(username: string, password: string): Promise<LdapUser> {
    try {
      return await authenticateIn('PRIMARY', username, password);
    } catch (error) {
      const notFound = error instanceof LdapAuthError && error.failure === 'not_found';
      if (!notFound || !isDirectoryConfigured('SECONDARY')) throw error;
    }
    logger.info('User not in primary directory, trying secondary', { username });
    return authenticateIn('SECONDARY', username, password);
  },

  /** Check if the primary LDAP is configured */
  isConfigured(): boolean {
    return isDirectoryConfigured('PRIMARY');
  },

  isSecondaryConfigured(): boolean {
    return isDirectoryConfigured('SECONDARY');
  },
};
