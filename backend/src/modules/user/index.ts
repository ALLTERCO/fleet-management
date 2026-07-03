import {getLogger} from 'log4js';
import {DEV_MODE} from '../../config';
import {
    PUBLIC_JWT_SECRET_FALLBACK,
    getJwtToken as readJwtToken
} from '../../config/jwtSecret';
import type {user_t} from '../../types';
import {
    authenticateFleetUserToken,
    getNodeRedServiceUser,
    NODE_RED_USER
} from '../authn';
import * as Observability from '../Observability';
import {ensureOrganizationProfile} from '../organizationModel';
import {ANONYMOUS_USERNAME} from './anonymous';
import {
    clearUserinfoCache,
    evictCachedUser,
    invalidateUserinfoCache,
    userinfoCache
} from './cache';
import UserComponent from './UserComponent';

export {
    effectiveOrganizationIdForAuthenticatedUser,
    hasPlatformAdminAuthority,
    hasTrustedPlatformAdmin,
    isAllowedForPinnedOrganization,
    resolveAuthenticatedOrganizationId,
    shouldLoadRolesFromDirectory as shouldLoadRolesFromZitadel,
    type TrustedOrganizationFallback
} from '../authz/coarse';
export {
    clearUserinfoCache,
    evictCachedUser,
    getNodeRedServiceUser,
    invalidateUserinfoCache,
    NODE_RED_USER
};

// Per-process guard: lazy-insert organization.profile on first tenant auth.
const ensuredTenantIds = new Set<string>();
function ensureTenantProfileOnce(orgId: string | undefined): void {
    if (!orgId || ensuredTenantIds.has(orgId)) return;
    ensuredTenantIds.add(orgId);
    void ensureOrganizationProfile(orgId);
}

const logger = getLogger('user');

// ============================================================================
// USER COMPONENT & CONSTANTS
// ============================================================================

// Lazy singleton — `app.ts:registerDefaultComponents()` triggers
// initialization. Module load itself is side-effect-free.
let userComponentInstance: UserComponent | null = null;

export function getUserComponent(): UserComponent {
    if (!userComponentInstance) {
        userComponentInstance = new UserComponent();
        Observability.registerModule('auth', {
            stats: () => ({
                userinfoCacheSize: userinfoCache.size
            }),
            topology: {
                role: 'service',
                cluster: 'security',
                downstreams: ['wsCommands', 'commander'],
                label: 'Auth',
                description: 'User authentication + userinfo cache',
                route: '/monitoring/services'
            }
        });
    }
    return userComponentInstance;
}

// Signing secret for FM-issued JWTs (Alexa, dev-mode, scoped PATs).
// Source: JWT_SECRET env var, then the dev fallback. Persistent component
// config is ignored so stale user.json cannot override deploy env.
export function getJwtToken(): string {
    return readJwtToken();
}

// Refuse to start if the JWT secret is missing or matches the public fallback.
// DEV_MODE keeps booting (with a critical warn) so local dev isn't blocked.
// Pure helper exported so tests don't need to stub the user module.
export function checkJwtSecret(
    secret: string,
    devMode: boolean,
    log: {error: typeof console.error; warn: typeof console.warn} = logger
): void {
    if (!secret || secret === PUBLIC_JWT_SECRET_FALLBACK) {
        const msg = `JWT secret is missing or equals the public fallback '${PUBLIC_JWT_SECRET_FALLBACK}'. Set JWT_SECRET (≥ 32 random bytes) in deploy/env/<env>.env and redeploy. All FM-signed tokens (Alexa, dev-mode, scoped PATs) are forgeable until this is fixed.`;
        if (devMode) {
            log.error('CRITICAL: %s — continuing because DEV_MODE=true', msg);
            return;
        }
        throw new Error(msg);
    }
    if (secret.length < 32) {
        log.warn(
            'JWT secret is shorter than 32 bytes (length=%d) — recommend rotating to a longer random value',
            secret.length
        );
    }
}

// Boot-time wrapper. Reads the live secret + DEV_MODE singleton.
export function assertJwtSecretConfigured(): void {
    checkJwtSecret(getJwtToken(), DEV_MODE);
}

export const UNAUTHORIZED_USER: user_t = {
    username: ANONYMOUS_USERNAME,
    password: '',
    permissions: [],
    group: '',
    enabled: false,
    roles: ['none']
};

// ============================================================================
// MAIN AUTHENTICATION FUNCTION
// ============================================================================

// Authenticate via Zitadel token. Role-based — V2 personas/assignments
// resolve custom grants downstream via CommandSender.loadV2EffectiveShape().
export async function getUserFromToken(
    token: string | undefined
): Promise<user_t | undefined> {
    const user = await getUserFromTokenInner(token);
    if (user?.organizationId) ensureTenantProfileOnce(user.organizationId);
    return user;
}

async function getUserFromTokenInner(
    token: string | undefined
): Promise<user_t | undefined> {
    return authenticateFleetUserToken(token);
}
