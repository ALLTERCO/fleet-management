import {getLogger} from 'log4js';
import passport from 'passport';
import {DEV_MODE, configRc} from '../../config';
import {
    type FleetPermissionConfig,
    parsePermissionConfig,
    roleToPermissionConfig
} from '../../model/permissions';
import type {user_t} from '../../types';
import * as AuditLogger from '../AuditLogger';
import * as Commander from '../Commander';
import * as Observability from '../Observability';
import * as store from '../PostgresProvider';
import {
    FLEET_ROLES,
    type FleetRole,
    type FleetPermissionConfig as ZitadelPermissionConfig,
    extractPermissionConfigFromClaims,
    extractRolesFromClaims,
    permissionConfigToGroup,
    permissionConfigToPermissions,
    zitadelService
} from '../zitadel';
import {
    USERINFO_CACHE_TTL_MS,
    clearUserinfoCache,
    hashToken,
    invalidateUserinfoCache,
    userinfoCache
} from './cache';
import {DefaultSigner} from './signers';

// Re-export cache utilities for external consumers
export {invalidateUserinfoCache, clearUserinfoCache};

// NOTE: zitadelService is only used for Node-RED service account (legacy).
// Normal user permissions come from userinfo (via Zitadel Action injection).
import UserComponent from './UserComponent';

const logger = getLogger('user');

/**
 * Fetch userinfo from Zitadel with caching.
 * Cache TTL is 5 minutes - balances freshness with performance.
 */
async function fetchUserinfoWithCache(
    accessToken: string
): Promise<Record<string, unknown> | null> {
    const cacheKey = hashToken(accessToken);
    const now = Date.now();

    // Check cache first
    const cached = userinfoCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < USERINFO_CACHE_TTL_MS) {
        logger.debug('Userinfo cache hit');
        Observability.incrementCounter('auth_cache_hits');
        return cached.data;
    }

    // Cache miss - fetch from Zitadel
    Observability.incrementCounter('auth_cache_misses');
    const authority = configRc.oidc?.backend?.authority;
    if (!authority) {
        return null;
    }

    const userinfoUrl = `${authority}/oidc/v1/userinfo`;

    try {
        const response = await fetch(userinfoUrl, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            logger.warn('Failed to fetch userinfo: %d', response.status);
            return null;
        }

        const userinfo = (await response.json()) as Record<string, unknown>;

        // Store in cache
        userinfoCache.set(cacheKey, {
            data: userinfo,
            fetchedAt: now
        });

        logger.debug(
            'Userinfo fetched and cached (keys: %s)',
            Object.keys(userinfo).join(', ')
        );
        return userinfo;
    } catch (error) {
        logger.warn('Error fetching userinfo: %s', error);
        return null;
    }
}

// ============================================================================
// USER COMPONENT & CONSTANTS
// ============================================================================

const component = new UserComponent();

// Zitadel introspection strategy name
const ZITADEL_STRATEGY = 'zitadel-introspection';

/**
 * Get JWT token for Alexa integration (legacy support)
 */
export function getJwtToken(): string {
    return component.getFullConfig().jwtToken || 'shelly-secret-token';
}

/**
 * Legacy Node-RED user for backwards compatibility
 */
export const NODE_RED_USER: user_t = {
    username: 'NODE_RED',
    password: '',
    permissions: ['*'],
    group: 'admin',
    enabled: false
};

/**
 * Get the Node-RED service account user.
 * If a service account is configured in Zitadel, fetch its permissions.
 * Otherwise, fall back to the default NODE_RED_USER with full permissions.
 */
export async function getNodeRedServiceUser(): Promise<user_t> {
    const serviceAccount = configRc.serviceAccounts?.nodered;

    if (serviceAccount?.userId && zitadelService.isAvailable()) {
        try {
            const metadata = await zitadelService.getUserMetadata(
                serviceAccount.userId
            );
            return {
                username: 'fleet-nodered',
                password: '',
                permissions:
                    metadata.permissions.length > 0
                        ? metadata.permissions
                        : ['*'],
                group: metadata.group || 'service',
                enabled: true
            };
        } catch (error) {
            logger.warn(
                'Failed to get Node-RED service account metadata, using defaults: %s',
                error
            );
        }
    }

    // Fall back to legacy NODE_RED_USER
    return NODE_RED_USER;
}

export const UNAUTHORIZED_USER: user_t = {
    username: '<UNAUTHORIZED>',
    password: '',
    permissions: [],
    group: '',
    enabled: false,
    role: 'none'
};

// ============================================================================
// DEV MODE AUTHENTICATION
// ============================================================================

/**
 * Authenticate user via local JWT token (DEV MODE ONLY).
 * Verifies the token and fetches user from local database.
 */
async function getUserFromTokenDevMode(
    token: string
): Promise<user_t | undefined> {
    try {
        const decoded = DefaultSigner.verify(token);
        if (!decoded || typeof decoded.username !== 'string') {
            logger.warn('Invalid dev mode token');
            return undefined;
        }

        const username = decoded.username;

        // Fetch user from local database
        const result = await store.userList({name: username});
        if (!result?.rows?.length) {
            logger.warn('Dev mode user not found: %s', username);
            return undefined;
        }

        const dbUser = result.rows[0];
        if (!dbUser.enabled) {
            logger.warn('Dev mode user disabled: %s', username);
            return undefined;
        }

        // Parse permissions - they may be stored as JSON string or array
        let permissions: string[] = [];
        if (Array.isArray(dbUser.permissions)) {
            permissions = dbUser.permissions;
        } else if (typeof dbUser.permissions === 'string') {
            try {
                permissions = JSON.parse(dbUser.permissions);
            } catch {
                permissions = [];
            }
        }

        const group = dbUser.group || 'user';
        const isAdmin = permissions.includes('*') || group === 'admin';

        logger.info(
            'Dev mode auth: user=%s, group=%s, permissions=%d',
            username,
            group,
            permissions.length
        );

        AuditLogger.logLogin(username, undefined, true);

        return {
            username,
            password: '',
            permissions,
            group,
            enabled: true,
            role: isAdmin ? FLEET_ROLES.ADMIN : FLEET_ROLES.VIEWER
        };
    } catch (error) {
        logger.error('Dev mode auth error: %s', error);
        return undefined;
    }
}

// ============================================================================
// MAIN AUTHENTICATION FUNCTION
// ============================================================================

/**
 * Authenticate user via token.
 *
 * In DEV MODE: Tries local JWT first, then falls back to Zitadel if configured.
 * In PRODUCTION: Uses Zitadel token introspection and userinfo only.
 *
 * Authentication flow (production):
 * 1. Introspect token with Zitadel (validates token is active)
 * 2. Fetch userinfo (cached for 5 min) to get fm_permissions
 * 3. If fm_permissions exists -> use custom permission config
 * 4. If not -> fallback to role-based permissions (admin/viewer)
 */
export async function getUserFromToken(
    token: string | undefined
): Promise<user_t | undefined> {
    if (!token) {
        logger.warn('No token provided for authentication');
        Observability.incrementCounter('auth_failures');
        return undefined;
    }

    // In dev mode, try local authentication first
    if (DEV_MODE) {
        const localUser = await getUserFromTokenDevMode(token);
        if (localUser) {
            return localUser;
        }
        // If local auth fails, try Zitadel (if configured)
        logger.debug('Dev mode local auth failed, trying Zitadel...');
    }

    // Try Zitadel authentication
    return getUserFromTokenZitadel(token);
}

/**
 * Authenticate via Zitadel token introspection
 */
function getUserFromTokenZitadel(token: string): Promise<user_t | undefined> {
    return new Promise<user_t>((resolve, reject) => {
        passport.authenticate(
            ZITADEL_STRATEGY,
            {session: false},
            async (err: Error, claims: Record<string, unknown>) => {
                if (err) {
                    logger.error('Introspection error: %s', err);
                    Observability.incrementCounter('auth_failures');
                    AuditLogger.logLogin(
                        'unknown',
                        undefined,
                        false,
                        String(err)
                    );
                    return reject(err);
                }
                if (!claims) {
                    logger.error(
                        'Token introspection failed - no claims returned'
                    );
                    Observability.incrementCounter('auth_failures');
                    AuditLogger.logLogin(
                        'unknown',
                        undefined,
                        false,
                        'Token introspection failed'
                    );
                    return reject('missingAccessToken');
                }

                // Extract user identifiers from introspection response
                const email =
                    (claims.email as string) ||
                    (claims.preferred_username as string) ||
                    'unknown';
                const sub = claims.sub as string;

                let permissions: string[] = [];
                let group = 'viewer';
                let role: FleetRole = FLEET_ROLES.VIEWER;
                let configSource = 'default';

                // Fetch userinfo (cached) to get fm_permissions
                // Requires Zitadel Action on "Pre userinfo creation" to inject fm_permissions
                const userinfo = await fetchUserinfoWithCache(token);

                // Try to extract fm_permissions from userinfo
                let permConfigResult: {
                    config:
                        | ZitadelPermissionConfig
                        | Record<string, unknown>
                        | null;
                    source: string | null;
                    error: string | null;
                    isCrudFormat?: boolean;
                } = {
                    config: null,
                    source: null,
                    error: null,
                    isCrudFormat: undefined
                };

                if (userinfo) {
                    // Debug: log fm_debug if present (from Zitadel Action)
                    if (userinfo.fm_debug) {
                        logger.info(
                            'Zitadel Action debug info: %s',
                            JSON.stringify(userinfo.fm_debug)
                        );
                    }
                    if (userinfo.fm_permissions_error) {
                        logger.warn(
                            'Zitadel Action fm_permissions error: %s',
                            userinfo.fm_permissions_error
                        );
                    }

                    permConfigResult =
                        extractPermissionConfigFromClaims(userinfo);
                }

                // Step 3: Apply permissions based on source
                let newPermissionConfig: FleetPermissionConfig | undefined;

                if (permConfigResult.config) {
                    // Check if this is the new CRUD format
                    if (permConfigResult.isCrudFormat) {
                        // New CRUD format - parse with the new permission model
                        const rawConfig = permConfigResult.config as Record<
                            string,
                            unknown
                        >;
                        newPermissionConfig =
                            parsePermissionConfig(rawConfig) ?? undefined;
                        if (newPermissionConfig) {
                            // For legacy compatibility, set permissions to empty and use new config
                            permissions = [];
                            // Determine group based on permissions
                            const hasAnyWrite = Object.values(
                                newPermissionConfig.components
                            ).some((comp) => {
                                if (!comp) return false;
                                return (
                                    comp.create ||
                                    comp.update ||
                                    comp.delete ||
                                    ('execute' in comp && comp.execute)
                                );
                            });
                            group = hasAnyWrite ? 'user' : 'viewer';
                            role = FLEET_ROLES.VIEWER;
                            configSource = 'userinfo/fm_permissions (CRUD)';

                            logger.info(
                                'User %s authenticated via CRUD METADATA - group: %s, config: %s',
                                email,
                                group,
                                JSON.stringify(newPermissionConfig.components)
                            );
                        } else {
                            // CRUD format detected but parsing failed - deny access
                            logger.warn(
                                'User %s has CRUD format permissions but failed to parse: %s',
                                email,
                                JSON.stringify(rawConfig)
                            );
                            permissions = [];
                            group = '';
                            role = FLEET_ROLES.NONE;
                            configSource =
                                'userinfo/fm_permissions (CRUD - parse failed)';
                        }
                    } else {
                        // Old format - use legacy parsing
                        permissions = permissionConfigToPermissions(
                            permConfigResult.config as any
                        );
                        group = permissionConfigToGroup(
                            permConfigResult.config as any
                        );
                        role =
                            group === 'admin'
                                ? FLEET_ROLES.ADMIN
                                : FLEET_ROLES.VIEWER;
                        configSource = 'userinfo/fm_permissions';

                        logger.info(
                            'User %s authenticated via METADATA - group: %s, permissions: %d',
                            email,
                            group,
                            permissions.length
                        );
                    }
                } else {
                    // fm_permissions not found in userinfo claims.
                    // Try fetching directly from Zitadel metadata API as fallback
                    // (handles case where Zitadel isn't configured to include metadata in tokens)
                    let fetchedFromApi = false;

                    if (sub && zitadelService.isManagementApiAvailable()) {
                        try {
                            logger.debug(
                                'User %s: fm_permissions not in claims, trying Zitadel metadata API (sub: %s)',
                                email,
                                sub
                            );
                            const apiConfig =
                                await zitadelService.getFmPermissions(sub);
                            if (apiConfig) {
                                const rawApiConfig =
                                    apiConfig as unknown as Record<
                                        string,
                                        unknown
                                    >;
                                if (
                                    rawApiConfig.components &&
                                    typeof rawApiConfig.components === 'object'
                                ) {
                                    newPermissionConfig =
                                        parsePermissionConfig(rawApiConfig) ??
                                        undefined;
                                    if (newPermissionConfig) {
                                        permissions = [];
                                        const hasAnyWrite = Object.values(
                                            newPermissionConfig.components
                                        ).some((comp) => {
                                            if (!comp) return false;
                                            return (
                                                comp.create ||
                                                comp.update ||
                                                comp.delete ||
                                                ('execute' in comp &&
                                                    comp.execute)
                                            );
                                        });
                                        group = hasAnyWrite ? 'user' : 'viewer';
                                        role = FLEET_ROLES.VIEWER;
                                        configSource =
                                            'zitadel-api/fm_permissions (CRUD)';
                                        fetchedFromApi = true;

                                        logger.info(
                                            'User %s authenticated via ZITADEL API METADATA - group: %s, config: %s',
                                            email,
                                            group,
                                            JSON.stringify(
                                                newPermissionConfig.components
                                            )
                                        );
                                    }
                                }
                            }
                        } catch (error) {
                            logger.debug(
                                'User %s: Zitadel metadata API fallback failed: %s',
                                email,
                                error
                            );
                        }
                    }

                    if (!fetchedFromApi) {
                        // Fallback to role-based permissions
                        // Try introspection claims first, then userinfo claims
                        // (userinfo often includes project roles even when
                        //  introspection responses don't)
                        let {primaryRole, claimKeyUsed} =
                            extractRolesFromClaims(claims);

                        if (primaryRole === FLEET_ROLES.NONE && userinfo) {
                            const fromUserinfo = extractRolesFromClaims(
                                userinfo as Record<string, unknown>
                            );
                            if (fromUserinfo.primaryRole !== FLEET_ROLES.NONE) {
                                primaryRole = fromUserinfo.primaryRole;
                                claimKeyUsed = fromUserinfo.claimKeyUsed
                                    ? `userinfo/${fromUserinfo.claimKeyUsed}`
                                    : null;
                            }
                        }

                        role = primaryRole;

                        const mapped =
                            zitadelService.mapRoleToPermissions(primaryRole);
                        permissions = mapped.permissions;
                        group = mapped.group;
                        configSource = claimKeyUsed
                            ? `role:${claimKeyUsed}`
                            : 'default';

                        // Also set the new permission config based on role
                        newPermissionConfig =
                            roleToPermissionConfig(primaryRole);

                        logger.info(
                            'User %s authenticated via ROLE - role: %s, group: %s, source: %s',
                            email,
                            primaryRole,
                            group,
                            configSource
                        );
                    }
                }

                // Log successful login
                Observability.incrementCounter('auth_successes');
                AuditLogger.logLogin(email, undefined, true);

                return resolve({
                    username: email,
                    password: '',
                    permissions,
                    group,
                    enabled: true,
                    role,
                    permissionConfig: newPermissionConfig
                } as user_t);
            }
        )({headers: {authorization: `bearer ${token}`}});
    });
}

export async function hasApiPermission(
    token: string | undefined,
    route: string
) {
    const user = await getUserFromToken(token);
    if (user === undefined) {
        return false;
    }

    return (
        user.permissions.includes('*') ||
        user.permissions.includes('api:*') ||
        user.permissions.includes(`api:${route}`)
    );
}

// Register observability
Observability.registerModule('auth', () => ({
    userinfoCacheSize: userinfoCache.size
}));

// add to commander
Commander.registerComponent(component);
