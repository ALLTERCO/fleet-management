import {getLogger} from 'log4js';
import passport from 'passport';
import {configRc, tuning} from '../../config';
import {oidcUserinfoEndpoint} from '../../config/oidcEndpoints';
import type {user_t} from '../../types';
import type {FleetRole} from '../../types/api/authzCatalog';
import * as AuditLogger from '../AuditLogger';
import {
    extractTokenRoles,
    mapRolesToPermissions,
    resolveAuthContext,
    resolveAuthenticatedOrganizationId
} from '../authz/coarse';
import {getDeploymentTopology, identityDirectory} from '../identity';
import * as Observability from '../Observability';
import {
    cacheUser,
    claimFirstLogin,
    currentEvictionGeneration,
    hashToken,
    markTokenRejected,
    USERINFO_CACHE_TTL_MS,
    unmarkTokenRejected,
    userinfoCache
} from '../user/cache';
import {userHasPresenceInTenant} from '../user/tokenStore';
import {truncateErrorForLog} from '../util/truncateErrorForLog';
import {withTimeout} from '../util/withTimeout';
import {buildAuthenticatedIdentity} from './TokenAuthenticator';
import {assertFleetTokenBinding} from './TokenBinding';

const logger = getLogger('authn');
const ZITADEL_STRATEGY = 'zitadel-introspection';

// Times the full introspection (Zitadel round-trip + claim resolution) into the
// slow-RPC ring as 'Auth.Introspect', so a slow login surfaces in the same Slow
// Operations view as everything else.
export async function authenticateExternalOidcToken(
    token: string
): Promise<user_t | undefined> {
    const startedAt = performance.now();
    // Captured before the Zitadel round-trip: a revoke that evicts the cache
    // mid-introspection bumps this, fencing off the late write.
    const evictionGeneration = currentEvictionGeneration();
    try {
        // Bound the Zitadel round-trip: passport's introspection has no timeout
        // of its own, so a hung IdP would otherwise stall every fresh auth
        // forever. On timeout this rejects, taking the same failure path the
        // caller already handles for any other introspection error.
        return await withTimeout(
            () => runIntrospection(token, evictionGeneration),
            tuning.zitadel.introspectionTimeoutMs,
            'zitadel-introspection'
        );
    } finally {
        Observability.noteRpcCompletion({
            method: 'Auth.Introspect',
            ms: performance.now() - startedAt,
            senderType: 'user'
        });
    }
}

function runIntrospection(
    token: string,
    evictionGeneration: number
): Promise<user_t | undefined> {
    return new Promise<user_t | undefined>((resolve, reject) => {
        passport.authenticate(
            ZITADEL_STRATEGY,
            {session: false},
            async (err: Error, claims: Record<string, unknown>) => {
                try {
                    const result = await resolveIntrospectionResult({
                        token,
                        err,
                        claims,
                        evictionGeneration
                    });
                    return resolve(result);
                } catch (error) {
                    return reject(error);
                }
            }
        )({headers: {authorization: `bearer ${token}`}});
    });
}

interface IntrospectionResult {
    token: string;
    err?: Error;
    claims?: Record<string, unknown>;
    evictionGeneration: number;
}

// Exported for tests.
export async function resolveIntrospectionResult({
    token,
    err,
    claims,
    evictionGeneration
}: IntrospectionResult): Promise<user_t | undefined> {
    if (err) return rejectTransientIntrospectionError(err);
    if (!claims) return rejectMissingClaims(token);

    unmarkTokenRejected(token);
    return buildUserFromClaims(token, claims, evictionGeneration);
}

function rejectTransientIntrospectionError(error: Error): never {
    logger.error(
        'Introspection error (transient): %j',
        truncateErrorForLog(error)
    );
    Observability.incrementCounter('auth_transient_errors');
    throw error;
}

// No claims = expired/invalid token (unauthenticated), not a server error:
// return undefined so callers close the socket instead of seeing a throw.
function rejectMissingClaims(token: string): undefined {
    logger.error('Token introspection failed - no claims returned');
    Observability.incrementCounter('auth_failures');
    markTokenRejected(token);
    AuditLogger.logLogin(
        'unknown',
        undefined,
        false,
        'Token introspection failed'
    );
    return undefined;
}

async function buildUserFromClaims(
    token: string,
    claims: Record<string, unknown>,
    evictionGeneration: number
): Promise<user_t | undefined> {
    try {
        const userinfo = await fetchUserinfoWithCache(token);
        const identity = buildAuthenticatedIdentity({claims, userinfo});
        const organizationId = await resolveTrustedOrganization({
            claims,
            userinfo,
            userId: identity.userId
        });
        const topology = getDeploymentTopology();
        const fleetProjectId =
            await identityDirectory.getDeploymentRoleScopeId();

        assertProjectBinding({
            claims,
            userinfo,
            userId: identity.userId,
            organizationId,
            fleetProjectId
        });

        const roleContext = await resolveRoles({
            claims,
            userinfo,
            userId: identity.userId,
            organizationId,
            fleetProjectId
        });
        const mapped = mapRolesToPermissions(roleContext.roles);

        logSuccessfulAuthentication({
            username: identity.username,
            roles: roleContext.roles,
            group: mapped.group,
            claimKeyUsed: roleContext.claimKeyUsed
        });

        Observability.incrementCounter('auth_successes');
        logFirstLogin({
            token,
            userId: identity.userId,
            username: identity.username,
            organizationId: roleContext.effectiveOrganizationId
        });

        const user: user_t = {
            username: identity.username,
            password: '',
            permissions: mapped.permissions,
            group: mapped.group,
            enabled: true,
            roles: roleContext.roles,
            organizationId: roleContext.effectiveOrganizationId,
            tenantPinned: topology.clientOrgId !== undefined,
            isPlatformAdmin: roleContext.isPlatformAdmin,
            userId: identity.userId,
            displayName: identity.displayName,
            mfaPresent: identity.mfaPresent
        };

        cacheAuthenticatedUser(
            token,
            user,
            identity.expiresAt,
            evictionGeneration
        );
        return user;
    } catch (error) {
        logger.error(
            'External auth failed after introspection: %j',
            truncateErrorForLog(error)
        );
        Observability.incrementCounter('auth_transient_errors');
        throw error;
    }
}

interface TrustedOrganizationInput {
    claims: Record<string, unknown>;
    userinfo: Record<string, unknown> | null;
    userId: string;
}

async function resolveTrustedOrganization({
    claims,
    userinfo,
    userId
}: TrustedOrganizationInput): Promise<string> {
    const topology = getDeploymentTopology();
    const organizationId = await resolveAuthenticatedOrganizationId({
        claims,
        userinfo,
        userId,
        pinnedOrgId: topology.clientOrgId,
        fallbackOrganizations: [
            {
                organizationId: topology.clientOrgId,
                reason: 'tenant'
            },
            {
                organizationId: topology.platformOrgId,
                reason: 'platform'
            }
        ],
        userBelongsToTenant: (candidateUserId, tenantId) =>
            identityDirectory.userBelongsToTenant({
                userId: candidateUserId,
                tenantId
            })
    });

    if (!organizationId) {
        logger.warn(
            'JWT has no trusted org context (sub=%s); rejecting',
            userId
        );
        Observability.incrementCounter('auth_failures');
        throw new Error('JWT missing organizationId');
    }
    return organizationId;
}

interface ProjectBindingInput {
    claims: Record<string, unknown>;
    userinfo: Record<string, unknown> | null;
    userId: string;
    organizationId: string;
    fleetProjectId: string;
}

function assertProjectBinding({
    claims,
    userinfo,
    userId,
    organizationId,
    fleetProjectId
}: ProjectBindingInput): void {
    const topology = getDeploymentTopology();
    const tenantPinnedToken =
        topology.clientOrgId !== undefined &&
        organizationId === topology.clientOrgId;
    const platformOrgToken =
        topology.platformOrgId !== undefined &&
        organizationId === topology.platformOrgId;

    try {
        assertFleetTokenBinding(claims, userinfo, fleetProjectId, {
            allowMissingProjectBinding: tenantPinnedToken || platformOrgToken
        });
    } catch (error) {
        logger.warn(
            '%s (sub=%s, project=%s); rejecting',
            (error as Error).message,
            userId,
            fleetProjectId
        );
        Observability.incrementCounter('auth_failures');
        throw error;
    }
}

interface RoleResolutionInput {
    claims: Record<string, unknown>;
    userinfo: Record<string, unknown> | null;
    userId: string;
    organizationId: string;
    fleetProjectId: string;
}

interface RoleResolutionResult {
    roles: FleetRole[];
    claimKeyUsed?: string;
    effectiveOrganizationId: string;
    isPlatformAdmin: boolean;
}

async function resolveRoles({
    claims,
    userinfo,
    userId,
    organizationId,
    fleetProjectId
}: RoleResolutionInput): Promise<RoleResolutionResult> {
    const tokenRoles = extractTokenRoles({
        claims,
        userinfo,
        projectId: fleetProjectId
    });
    const authContext = await resolveAuthContext({
        userId,
        authOrgId: organizationId,
        roles: tokenRoles.roles,
        roleSource: tokenRoles.claimKeyUsed,
        topology: getDeploymentTopology(),
        identityDirectory,
        hasFineGrainedAccess: ({tenantId, userId: scopedUserId}) =>
            userHasPresenceInTenant(tenantId, scopedUserId)
    });

    if (!authContext.ok) {
        rejectAuthContextFailure({
            reason: authContext.reason,
            organizationId
        });
    }

    return {
        roles: authContext.context.roles,
        claimKeyUsed: authContext.roleSource ?? undefined,
        effectiveOrganizationId: authContext.context.effectiveOrgId,
        isPlatformAdmin: authContext.context.isPlatformAdmin
    };
}

function rejectAuthContextFailure(input: {
    reason: 'org_mismatch';
    organizationId: string;
}): never {
    const topology = getDeploymentTopology();
    logger.warn(
        'JWT org mismatch — pinned to %s, got %s; rejecting',
        topology.clientOrgId,
        input.organizationId
    );
    Observability.incrementCounter('auth_failures');
    throw new Error('JWT org mismatch');
}

async function fetchUserinfoWithCache(
    accessToken: string
): Promise<Record<string, unknown> | null> {
    const cacheKey = hashToken(accessToken);
    const now = Date.now();
    const cached = userinfoCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < USERINFO_CACHE_TTL_MS) {
        logger.debug('Userinfo cache hit');
        Observability.incrementCounter('auth_cache_hits');
        return cached.data;
    }

    Observability.incrementCounter('auth_cache_misses');
    const oidcBackend = configRc.oidc?.backend;
    if (!oidcBackend) return null;

    const userinfo = await fetchUserinfo(
        oidcUserinfoEndpoint(oidcBackend),
        accessToken
    );
    if (!userinfo) return null;

    userinfoCache.set(cacheKey, {data: userinfo, fetchedAt: now});
    logger.debug(
        'Userinfo fetched and cached (keys: %s)',
        Object.keys(userinfo).join(', ')
    );
    return userinfo;
}

export async function fetchUserinfo(
    userinfoUrl: string,
    accessToken: string
): Promise<Record<string, unknown> | null> {
    try {
        const response = await fetch(userinfoUrl, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            },
            // Bound a hung IdP so an unresponsive userinfo endpoint can't stall
            // the auth request forever.
            signal: AbortSignal.timeout(tuning.zitadel.userinfoFetchTimeoutMs)
        });
        if (!response.ok) {
            logger.warn('Failed to fetch userinfo: %d', response.status);
            return null;
        }
        return (await response.json()) as Record<string, unknown>;
    } catch (error) {
        logger.warn('Error fetching userinfo: %s', error);
        return null;
    }
}

function logSuccessfulAuthentication(input: {
    username: string;
    roles: readonly FleetRole[];
    group: string;
    claimKeyUsed?: string;
}): void {
    const configSource = input.claimKeyUsed
        ? `role:${input.claimKeyUsed}`
        : 'default';
    logger.info(
        'User %s authenticated via ROLE - role: %s, group: %s, source: %s',
        input.username,
        input.roles[0],
        input.group,
        configSource
    );
}

function logFirstLogin(input: {
    token: string;
    userId: string;
    username: string;
    organizationId: string;
}): void {
    if (!claimFirstLogin(input.token)) return;
    AuditLogger.logLogin(
        input.username,
        undefined,
        true,
        undefined,
        input.organizationId,
        input.userId
    );
}

function cacheAuthenticatedUser(
    token: string,
    user: user_t,
    expiresAt: number | undefined,
    evictionGeneration: number
): void {
    // Don't cache no-access identities — 'none' or an empty role set. A later
    // grant (group/assignment) must take effect without waiting for the
    // introspection cache to expire.
    if (!user.roles?.length || user.roles[0] === 'none') return;
    cacheUser(token, user, expiresAt, {evictionGeneration});
}
