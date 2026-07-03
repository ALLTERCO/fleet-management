import {timingSafeEqual} from 'node:crypto';

// Length guard first: timingSafeEqual throws on unequal lengths.
export function tokensMatch(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export interface AuthenticatedIdentity {
    userId: string;
    username: string;
    // OIDC `name` claim — the operator's real display name. Falls back to
    // username (email) when the token carries no name. Snapshotted by audit
    // and alert-actor writers; never used as an identity key.
    displayName: string;
    mfaPresent: boolean;
    expiresAt?: number;
}

export interface ScopedTokenClaims {
    tokenId: string;
}

interface TokenAuthAttempt<TUser> {
    handled: boolean;
    user?: TUser;
}

// One service-token branch. Node-RED, Grafana, and any future service
// integration register one of these. Tried in array order during auth.
export interface ServiceTokenProvider<TUser> {
    label: string;
    getToken(): string | undefined;
    getUser(): Promise<TUser>;
    isEnabled(user: TUser): boolean;
}

interface TokenAuthenticatorDeps<TUser> {
    isRejected(token: string): boolean;
    markRejected(token: string): void;
    getCachedUser(token: string): TUser | undefined;
    verifyScopedToken(token: string): ScopedTokenClaims | undefined;
    loadScopedTokenUser(
        token: string,
        tokenId: string
    ): Promise<TUser | undefined>;
    serviceTokenProviders: ServiceTokenProvider<TUser>[];
    cacheUser(token: string, user: TUser): void;
    isDevMode(): boolean;
    getDevModeUser(token: string): Promise<TUser | undefined>;
    isExternalIdentityProviderConfigured(): boolean;
    getInflightExternalAuth(
        token: string
    ): Promise<TUser | undefined> | undefined;
    registerInflightExternalAuth(
        token: string,
        promise: Promise<TUser | undefined>
    ): void;
    authenticateExternalToken(token: string): Promise<TUser | undefined>;
    incrementCounter(name: string): void;
    warn(message: string): void;
    debug(message: string): void;
}

export class TokenAuthenticator<TUser> {
    constructor(private readonly deps: TokenAuthenticatorDeps<TUser>) {}

    async authenticate(token: string | undefined): Promise<TUser | undefined> {
        if (!token) return this.rejectMissingToken();
        if (this.deps.isRejected(token)) return this.rejectCachedToken();

        const scopedToken = await this.authenticateScopedToken(token);
        if (scopedToken.handled) return scopedToken.user;

        const cached = this.getCachedUser(token);
        if (cached) return cached;

        const serviceUser = await this.authenticateServiceTokens(token);
        if (serviceUser) return serviceUser;

        const devModeUser = await this.authenticateDevModeToken(token);
        if (devModeUser || this.deps.isRejected(token)) return devModeUser;

        return this.authenticateExternalToken(token);
    }

    private rejectMissingToken(): undefined {
        this.deps.warn('No token provided for authentication');
        this.deps.incrementCounter('auth_failures');
        return undefined;
    }

    private rejectCachedToken(): undefined {
        this.deps.incrementCounter('auth_cached_rejects');
        return undefined;
    }

    private getCachedUser(token: string): TUser | undefined {
        const cached = this.deps.getCachedUser(token);
        if (cached) this.deps.incrementCounter('auth_cache_hits');
        return cached;
    }

    private async authenticateScopedToken(
        token: string
    ): Promise<TokenAuthAttempt<TUser>> {
        const claims = this.deps.verifyScopedToken(token);
        if (!claims) return {handled: false};

        const user = await this.deps.loadScopedTokenUser(token, claims.tokenId);
        if (user) return {handled: true, user};

        this.deps.markRejected(token);
        this.deps.incrementCounter('auth_failures');
        this.deps.incrementCounter('fm_scoped_pat_rejected');
        return {handled: true};
    }

    private async authenticateServiceTokens(
        token: string
    ): Promise<TUser | undefined> {
        for (const provider of this.deps.serviceTokenProviders) {
            const expected = provider.getToken();
            if (!expected || !tokensMatch(token, expected)) continue;

            const serviceUser = await provider.getUser();
            if (!provider.isEnabled(serviceUser)) {
                this.deps.warn(
                    `${provider.label} service token rejected: service user disabled or unscoped`
                );
                this.deps.markRejected(token);
                return undefined;
            }

            // No eviction-generation fence: a service token's identity is
            // config-fixed, so there's no role-revoke race to lose.
            this.deps.cacheUser(token, serviceUser);
            return serviceUser;
        }
        return undefined;
    }

    private async authenticateDevModeToken(
        token: string
    ): Promise<TUser | undefined> {
        if (!this.deps.isDevMode()) return undefined;

        const localUser = await this.deps.getDevModeUser(token);
        if (localUser) return localUser;

        if (!this.deps.isExternalIdentityProviderConfigured()) {
            this.deps.warn('Invalid dev mode token');
            this.deps.markRejected(token);
            return undefined;
        }

        this.deps.debug('Dev mode local auth failed, trying external identity');
        return undefined;
    }

    private authenticateExternalToken(
        token: string
    ): Promise<TUser | undefined> {
        const inflight = this.deps.getInflightExternalAuth(token);
        if (inflight) return inflight;

        const authentication = this.deps.authenticateExternalToken(token);
        this.deps.registerInflightExternalAuth(token, authentication);
        return authentication;
    }
}

interface BuildAuthenticatedIdentityParams {
    claims: Record<string, unknown>;
    userinfo: Record<string, unknown> | null;
}

export function buildAuthenticatedIdentity({
    claims,
    userinfo
}: BuildAuthenticatedIdentityParams): AuthenticatedIdentity {
    const username = getUsername({claims, userinfo});
    return {
        userId: getRequiredSubject(claims),
        username,
        displayName: getDisplayName({claims, userinfo}, username),
        mfaPresent: hasMfaAuthenticationMethod({claims, userinfo}),
        expiresAt: getNumericClaim(claims.exp)
    };
}

function getRequiredSubject(claims: Record<string, unknown>): string {
    const subject = getStringClaim(claims.sub);
    if (!subject) throw new Error('JWT missing subject');
    return subject;
}

function getUsername({
    claims,
    userinfo
}: BuildAuthenticatedIdentityParams): string {
    return (
        getStringClaim(claims.email) ||
        getStringClaim(userinfo?.email) ||
        getStringClaim(claims.preferred_username) ||
        getStringClaim(userinfo?.preferred_username) ||
        'unknown'
    );
}

// Real name from the OIDC `name` claim. Service tokens and bare PATs may omit
// it; falling back to username (email) is intentional, not a silent mask.
function getDisplayName(
    {claims, userinfo}: BuildAuthenticatedIdentityParams,
    username: string
): string {
    return (
        getStringClaim(claims.name) ||
        getStringClaim(userinfo?.name) ||
        username
    );
}

function hasMfaAuthenticationMethod({
    claims,
    userinfo
}: BuildAuthenticatedIdentityParams): boolean {
    return stringArrayClaim(claims.amr ?? userinfo?.amr).includes('mfa');
}

function getStringClaim(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNumericClaim(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

function stringArrayClaim(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}
