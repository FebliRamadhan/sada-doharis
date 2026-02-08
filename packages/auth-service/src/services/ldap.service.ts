import ldap from 'ldapjs';
import { createLogger, UnauthorizedError, type LdapUser } from '@sada/shared';

const logger = createLogger('ldap-service');

const LDAP_URL = process.env['LDAP_URL'] ?? 'ldap://localhost:389';
const LDAP_BIND_DN = process.env['LDAP_BIND_DN'] ?? '';
const LDAP_BIND_PASSWORD = process.env['LDAP_BIND_PASSWORD'] ?? '';
const LDAP_SEARCH_BASE = process.env['LDAP_SEARCH_BASE'] ?? '';
const LDAP_SEARCH_FILTER = process.env['LDAP_SEARCH_FILTER'] ?? '(uid={{username}})';

export const ldapService = {
    /**
     * Authenticate user via LDAP
     */
    async authenticate(username: string, password: string): Promise<LdapUser> {
        return new Promise((resolve, reject) => {
            const client = ldap.createClient({
                url: LDAP_URL,
                timeout: 5000,
                connectTimeout: 10000,
            });

            client.on('error', (err) => {
                logger.error('LDAP connection error', { error: err.message });
                reject(new UnauthorizedError('LDAP connection failed'));
            });

            // First, bind with service account to search for user
            client.bind(LDAP_BIND_DN, LDAP_BIND_PASSWORD, (bindErr) => {
                if (bindErr) {
                    logger.error('LDAP bind error', { error: bindErr.message });
                    client.destroy();
                    reject(new UnauthorizedError('LDAP authentication failed'));
                    return;
                }

                // Search for user
                const searchFilter = LDAP_SEARCH_FILTER.replace('{{username}}', username);
                const searchOptions: ldap.SearchOptions = {
                    filter: searchFilter,
                    scope: 'sub',
                    attributes: ['dn', 'uid', 'cn', 'mail', 'department', 'title'],
                };

                client.search(LDAP_SEARCH_BASE, searchOptions, (searchErr, res) => {
                    if (searchErr) {
                        logger.error('LDAP search error', { error: searchErr.message });
                        client.destroy();
                        reject(new UnauthorizedError('User not found'));
                        return;
                    }

                    let userEntry: ldap.SearchEntry | null = null;

                    res.on('searchEntry', (entry) => {
                        userEntry = entry;
                    });

                    res.on('error', (err) => {
                        logger.error('LDAP search result error', { error: err.message });
                        client.destroy();
                        reject(new UnauthorizedError('User not found'));
                    });

                    res.on('end', () => {
                        if (!userEntry) {
                            client.destroy();
                            reject(new UnauthorizedError('User not found'));
                            return;
                        }

                        const userDn = userEntry.dn.toString();

                        // Authenticate user with their password
                        client.bind(userDn, password, (authErr) => {
                            client.destroy();

                            if (authErr) {
                                logger.warn('LDAP authentication failed', { username });
                                reject(new UnauthorizedError('Invalid credentials'));
                                return;
                            }

                            // Extract user attributes
                            const getAttribute = (name: string): string | undefined => {
                                const entry = userEntry as unknown as { object?: Record<string, unknown> };
                                const attr = entry.object?.[name];
                                if (Array.isArray(attr)) return String(attr[0]);
                                return attr ? String(attr) : undefined;
                            };

                            const ldapUser: LdapUser = {
                                dn: userDn,
                                uid: getAttribute('uid') ?? username,
                                cn: getAttribute('cn') ?? username,
                                mail: getAttribute('mail') ?? '',
                                department: getAttribute('department'),
                                title: getAttribute('title'),
                            };

                            logger.info('LDAP authentication successful', { username });
                            resolve(ldapUser);
                        });
                    });
                });
            });
        });
    },

    /**
     * Check if LDAP is configured
     */
    isConfigured(): boolean {
        return !!(LDAP_URL && LDAP_BIND_DN && LDAP_SEARCH_BASE);
    },
};
