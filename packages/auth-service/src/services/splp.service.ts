import { createLogger, UnauthorizedError, type SplpUser } from '@sada/shared';

const logger = createLogger('splp-service');

const SPLP_CLIENT_ID = process.env['SPLP_CLIENT_ID'] ?? '';
const SPLP_CLIENT_SECRET = process.env['SPLP_CLIENT_SECRET'] ?? '';
const SPLP_AUTHORIZATION_URL = process.env['SPLP_AUTHORIZATION_URL'] ?? 'https://splp.go.id/oauth/authorize';
const SPLP_TOKEN_URL = process.env['SPLP_TOKEN_URL'] ?? 'https://splp.go.id/oauth/token';
const SPLP_USERINFO_URL = process.env['SPLP_USERINFO_URL'] ?? 'https://splp.go.id/api/userinfo';
const SPLP_REDIRECT_URI = process.env['SPLP_REDIRECT_URI'] ?? '';

export const splpService = {
    /**
     * Generate SPLP authorization URL
     */
    getAuthorizationUrl(state: string): string {
        const params = new URLSearchParams({
            client_id: SPLP_CLIENT_ID,
            redirect_uri: SPLP_REDIRECT_URI,
            response_type: 'code',
            scope: 'openid profile email',
            state,
        });

        return `${SPLP_AUTHORIZATION_URL}?${params.toString()}`;
    },

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken?: string }> {
        try {
            const response = await fetch(SPLP_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: SPLP_CLIENT_ID,
                    client_secret: SPLP_CLIENT_SECRET,
                    redirect_uri: SPLP_REDIRECT_URI,
                    code,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                logger.error('SPLP token exchange failed', { error });
                throw new UnauthorizedError('SPLP authentication failed');
            }

            const data = await response.json() as {
                access_token: string;
                refresh_token?: string;
            };

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
            };
        } catch (error) {
            logger.error('SPLP token exchange error', { error });
            throw new UnauthorizedError('SPLP authentication failed');
        }
    },

    /**
     * Get user info from SPLP
     */
    async getUserInfo(accessToken: string): Promise<SplpUser> {
        try {
            const response = await fetch(SPLP_USERINFO_URL, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) {
                const error = await response.text();
                logger.error('SPLP userinfo failed', { error });
                throw new UnauthorizedError('Failed to get SPLP user info');
            }

            const data = await response.json() as {
                nip: string;
                nama: string;
                email: string;
                unit_kerja: string;
                jabatan?: string;
                instansi?: string;
            };

            return {
                nip: data.nip,
                nama: data.nama,
                email: data.email,
                unitKerja: data.unit_kerja,
                jabatan: data.jabatan,
                instansi: data.instansi,
            };
        } catch (error) {
            logger.error('SPLP userinfo error', { error });
            throw new UnauthorizedError('Failed to get SPLP user info');
        }
    },

    /**
     * Check if SPLP is configured
     */
    isConfigured(): boolean {
        return !!(SPLP_CLIENT_ID && SPLP_CLIENT_SECRET && SPLP_REDIRECT_URI);
    },
};
