import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// =============================================
// Mock ldapjs
// =============================================

const mockBind = vi.fn();
const mockSearch = vi.fn();
const mockDestroy = vi.fn();
const mockOn = vi.fn();

const mockClient = {
    bind: mockBind,
    search: mockSearch,
    destroy: mockDestroy,
    on: mockOn,
};

vi.mock('ldapjs', () => ({
    default: {
        createClient: vi.fn(() => mockClient),
    },
}));

vi.mock('@sada/shared', () => ({
    UnauthorizedError: class UnauthorizedError extends Error {
        constructor(msg: string) {
            super(msg);
            this.name = 'UnauthorizedError';
        }
    },
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })),
}));

// =============================================
// Test helpers
// =============================================

/** Create a mock SearchEntry with given attributes */
function createMockSearchEntry(attrs: Record<string, string>) {
    return {
        dn: { toString: () => attrs.dn || 'uid=testuser,ou=users,dc=example,dc=com' },
        object: attrs,
    };
}

/** Create EventEmitter-based search response */
function createSearchResponse() {
    return new EventEmitter();
}

// =============================================
// Tests
// =============================================

describe('ldapService', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Set environment variables
        vi.stubEnv('LDAP_URL', 'ldap://test-ldap:389');
        vi.stubEnv('LDAP_BIND_DN', 'cn=admin,dc=example,dc=com');
        vi.stubEnv('LDAP_BIND_PASSWORD', 'admin_pass');
        vi.stubEnv('LDAP_SEARCH_BASE', 'ou=users,dc=example,dc=com');
        vi.stubEnv('LDAP_SEARCH_FILTER', '(uid={{username}})');

        // Default: no connection error
        mockOn.mockImplementation(() => { });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    // -----------------------------------------
    // authenticate()
    // -----------------------------------------
    describe('authenticate', () => {
        it('should authenticate user successfully', async () => {
            // Setup: service account bind succeeds
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                cb(null);
            });

            // Setup: search finds user
            const searchRes = createSearchResponse();
            mockSearch.mockImplementation((_base: string, _opts: unknown, cb: (err: Error | null, res: EventEmitter) => void) => {
                cb(null, searchRes);

                // Emit search entry asynchronously
                process.nextTick(() => {
                    searchRes.emit('searchEntry', createMockSearchEntry({
                        dn: 'uid=john.doe,ou=users,dc=example,dc=com',
                        uid: 'john.doe',
                        cn: 'John Doe',
                        mail: 'john.doe@example.com',
                        department: 'IT',
                        title: 'Engineer',
                    }));
                    searchRes.emit('end');
                });
            });

            // Override bind: first call = service account, second call = user auth
            let bindCallCount = 0;
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                bindCallCount++;
                cb(null); // Both binds succeed
            });

            const { ldapService } = await import('../services/ldap.service.js');
            const result = await ldapService.authenticate('john.doe', 'password123');

            expect(result).toEqual({
                dn: 'uid=john.doe,ou=users,dc=example,dc=com',
                uid: 'john.doe',
                cn: 'John Doe',
                mail: 'john.doe@example.com',
                department: 'IT',
                title: 'Engineer',
            });
            expect(bindCallCount).toBe(2); // service bind + user bind
            expect(mockDestroy).toHaveBeenCalled();
        });

        it('should reject when service account bind fails', async () => {
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                cb(new Error('Bind failed'));
            });

            const { ldapService } = await import('../services/ldap.service.js');

            await expect(ldapService.authenticate('john.doe', 'password123'))
                .rejects.toThrow('LDAP authentication failed');

            expect(mockDestroy).toHaveBeenCalled();
        });

        it('should reject when user is not found in LDAP', async () => {
            // Service bind succeeds
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                cb(null);
            });

            // Search returns no entries
            const searchRes = createSearchResponse();
            mockSearch.mockImplementation((_base: string, _opts: unknown, cb: (err: Error | null, res: EventEmitter) => void) => {
                cb(null, searchRes);
                process.nextTick(() => {
                    searchRes.emit('end'); // No entries emitted
                });
            });

            const { ldapService } = await import('../services/ldap.service.js');

            await expect(ldapService.authenticate('unknown.user', 'password123'))
                .rejects.toThrow('User not found');

            expect(mockDestroy).toHaveBeenCalled();
        });

        it('should reject when user password is incorrect', async () => {
            // First bind (service) succeeds, second bind (user) fails
            let bindCallCount = 0;
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                bindCallCount++;
                if (bindCallCount === 1) {
                    cb(null); // Service bind OK
                } else {
                    cb(new Error('Invalid credentials')); // User bind fails
                }
            });

            const searchRes = createSearchResponse();
            mockSearch.mockImplementation((_base: string, _opts: unknown, cb: (err: Error | null, res: EventEmitter) => void) => {
                cb(null, searchRes);
                process.nextTick(() => {
                    searchRes.emit('searchEntry', createMockSearchEntry({
                        dn: 'uid=john.doe,ou=users,dc=example,dc=com',
                        uid: 'john.doe',
                        cn: 'John Doe',
                        mail: 'john.doe@example.com',
                    }));
                    searchRes.emit('end');
                });
            });

            const { ldapService } = await import('../services/ldap.service.js');

            await expect(ldapService.authenticate('john.doe', 'wrong_password'))
                .rejects.toThrow('Invalid credentials');

            expect(mockDestroy).toHaveBeenCalled();
        });

        it('should reject when search returns error', async () => {
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                cb(null);
            });

            // Search itself errors
            mockSearch.mockImplementation((_base: string, _opts: unknown, cb: (err: Error | null, res: EventEmitter) => void) => {
                cb(new Error('Search failed'), null as unknown as EventEmitter);
            });

            const { ldapService } = await import('../services/ldap.service.js');

            await expect(ldapService.authenticate('john.doe', 'password123'))
                .rejects.toThrow('User not found');

            expect(mockDestroy).toHaveBeenCalled();
        });

        it('should reject when search result emits error event', async () => {
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                cb(null);
            });

            const searchRes = createSearchResponse();
            mockSearch.mockImplementation((_base: string, _opts: unknown, cb: (err: Error | null, res: EventEmitter) => void) => {
                cb(null, searchRes);
                process.nextTick(() => {
                    searchRes.emit('error', new Error('Search result error'));
                });
            });

            const { ldapService } = await import('../services/ldap.service.js');

            await expect(ldapService.authenticate('john.doe', 'password123'))
                .rejects.toThrow('User not found');

            expect(mockDestroy).toHaveBeenCalled();
        });

        it('should handle user with missing optional attributes', async () => {
            let bindCallCount = 0;
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                bindCallCount++;
                cb(null);
            });

            const searchRes = createSearchResponse();
            mockSearch.mockImplementation((_base: string, _opts: unknown, cb: (err: Error | null, res: EventEmitter) => void) => {
                cb(null, searchRes);
                process.nextTick(() => {
                    searchRes.emit('searchEntry', createMockSearchEntry({
                        dn: 'uid=minimal,ou=users,dc=example,dc=com',
                        uid: 'minimal',
                        cn: 'Minimal User',
                        // No mail, department, title
                    }));
                    searchRes.emit('end');
                });
            });

            const { ldapService } = await import('../services/ldap.service.js');
            const result = await ldapService.authenticate('minimal', 'password123');

            expect(result.uid).toBe('minimal');
            expect(result.cn).toBe('Minimal User');
            expect(result.mail).toBe('');
            expect(result.department).toBeUndefined();
            expect(result.title).toBeUndefined();
        });

        it('should handle attributes returned as arrays', async () => {
            let bindCallCount = 0;
            mockBind.mockImplementation((_dn: string, _pw: string, cb: (err: Error | null) => void) => {
                bindCallCount++;
                cb(null);
            });

            const searchRes = createSearchResponse();
            mockSearch.mockImplementation((_base: string, _opts: unknown, cb: (err: Error | null, res: EventEmitter) => void) => {
                cb(null, searchRes);
                process.nextTick(() => {
                    const entry = {
                        dn: { toString: () => 'uid=arrayuser,ou=users,dc=example,dc=com' },
                        object: {
                            uid: ['arrayuser'],
                            cn: ['Array User'],
                            mail: ['array@example.com'],
                            department: ['Engineering', 'IT'], // Multi-value
                        },
                    };
                    searchRes.emit('searchEntry', entry);
                    searchRes.emit('end');
                });
            });

            const { ldapService } = await import('../services/ldap.service.js');
            const result = await ldapService.authenticate('arrayuser', 'password123');

            expect(result.uid).toBe('arrayuser');
            expect(result.cn).toBe('Array User');
            expect(result.mail).toBe('array@example.com');
            expect(result.department).toBe('Engineering'); // First element
        });
    });

    // -----------------------------------------
    // isConfigured()
    // -----------------------------------------
    describe('isConfigured', () => {
        it('should return true when LDAP is fully configured', async () => {
            const { ldapService } = await import('../services/ldap.service.js');
            expect(ldapService.isConfigured()).toBe(true);
        });

        it('should return false when LDAP_BIND_DN is empty', async () => {
            vi.stubEnv('LDAP_BIND_DN', '');

            // Need fresh import to pick up new env values
            vi.resetModules();
            const { ldapService } = await import('../services/ldap.service.js');
            expect(ldapService.isConfigured()).toBe(false);
        });

        it('should return false when LDAP_SEARCH_BASE is empty', async () => {
            vi.stubEnv('LDAP_SEARCH_BASE', '');

            vi.resetModules();
            const { ldapService } = await import('../services/ldap.service.js');
            expect(ldapService.isConfigured()).toBe(false);
        });
    });
});
