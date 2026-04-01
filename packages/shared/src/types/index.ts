// ============================================
// User Types
// ============================================

export enum UserType {
    INTERNAL = 'INTERNAL',       // LDAP users (karyawan internal)
    GOVERNMENT = 'GOVERNMENT',   // SPLP users (ASN pemerintahan)
    EXTERNAL = 'EXTERNAL',       // Social auth users (masyarakat umum)
}

export interface User {
    id: string;
    email: string;
    name: string;
    userType: UserType;
    ldapDn?: string | null;
    provider?: string | null;
    providerId?: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserCreate {
    email: string;
    password?: string;
    name: string;
    userType?: UserType;
    ldapDn?: string;
    provider?: string;
    providerId?: string;
}

// ============================================
// OAuth Types
// ============================================

export type OAuthGrantType = 'authorization_code' | 'client_credentials' | 'refresh_token';

export interface OAuthClient {
    id: string;
    clientId: string;
    clientSecret: string;
    name: string;
    redirectUris: string[];
    grants: OAuthGrantType[];
    scopes: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface OAuthClientCreate {
    name: string;
    redirectUris: string[];
    grants: OAuthGrantType[];
    scopes: string[];
}

export interface OAuthToken {
    id: string;
    accessToken: string;
    refreshToken?: string | null;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt?: Date | null;
    scopes: string[];
    userId?: string | null;
    clientId: string;
    createdAt: Date;
}

export interface OAuthAuthorizationCode {
    id: string;
    code: string;
    redirectUri: string;
    scopes: string[];
    expiresAt: Date;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
    userId: string;
    clientId: string;
    createdAt: Date;
}

// ============================================
// Token Payload Types
// ============================================

export interface AccessTokenPayload {
    sub: string;           // User ID or Client ID
    type: 'user' | 'client';
    scopes: string[];
    exp: number;
    iat: number;
}

export interface RefreshTokenPayload {
    sub: string;
    type: 'user' | 'client';
    jti: string;           // Token ID for revocation
    exp: number;
    iat: number;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: ApiError;
    meta?: ApiMeta;
}

export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
}

export interface ApiMeta {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
}

// ============================================
// Pagination Types
// ============================================

export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
    data: T[];
    meta: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

// ============================================
// Auth Provider Types
// ============================================

export type AuthProvider = 'ldap' | 'splp' | 'google' | 'facebook' | 'local';

export interface SocialProfile {
    id: string;
    email: string;
    name: string;
    provider: AuthProvider;
    rawProfile: Record<string, unknown>;
}

export interface LdapUser {
    dn: string;
    uid: string;
    cn: string;
    mail: string;
    department?: string;
    title?: string;
}

export interface SplpUser {
    nip: string;
    nama: string;
    email: string;
    unitKerja: string;
    jabatan?: string;
    instansi?: string;
}

// ============================================
// OIDC Types
// ============================================

export interface OIDCIdTokenPayload {
    iss: string;
    sub: string;
    aud: string;
    exp: number;
    iat: number;
    nonce?: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
    preferred_username?: string;
}

export interface OIDCUserInfoResponse {
    sub: string;
    name?: string;
    email?: string;
    email_verified?: boolean;
    preferred_username?: string;
}

export interface TokenIntrospectionResponse {
    active: boolean;
    sub?: string;
    scope?: string;
    client_id?: string;
    token_type?: string;
    exp?: number;
    iat?: number;
    username?: string;
}

export interface JWK {
    kty: string;
    use: string;
    kid: string;
    alg: string;
    n: string;
    e: string;
}

export interface JWKSResponse {
    keys: JWK[];
}
