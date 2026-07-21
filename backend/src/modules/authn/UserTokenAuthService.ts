import {getLogger} from 'log4js';
import {
    configRc,
    DEV_MODE,
    isZitadelConfigured,
    type ServiceAccountConfig,
    tuning
} from '../../config';
import {envCsv, envStr} from '../../config/envReader';
import type {user_t} from '../../types';
import * as AuditLogger from '../AuditLogger';
import {FLEET_ROLES, mapRolesToPermissions} from '../authz/coarse';
import {identityDirectory} from '../identity';
import * as Observability from '../Observability';
import * as store from '../PostgresProvider';
import {
    cacheUser,
    claimFirstLogin,
    getCachedUser,
    getInflightIntrospection,
    isTokenRejected,
    markTokenRejected,
    registerInflightIntrospection
} from '../user/cache';
import {DefaultSigner, ScopedTokenSigner} from '../user/signers';
import {getActiveScopedPat, touchScopedPatLastUsed} from '../user/tokenStore';
import {authenticateExternalOidcToken} from './ExternalTokenUserResolver';
import {
    type ServiceTokenProvider,
    TokenAuthenticator
} from './TokenAuthenticator';

const logger = getLogger('authn');

function nodeRedOrgId(): string | undefined {
    const value = envStr('FM_NODE_RED_ORG_ID', '').trim();
    return value.length > 0 ? value : undefined;
}

function nodeRedPermissions(): string[] {
    return [...envCsv('FM_NODE_RED_PERMISSIONS', [])];
}

function nodeRedServiceToken(): string {
    return (
        envStr('FM_NODE_RED_SERVICE_TOKEN', '').trim() ||
        configRc.serviceAccounts?.nodered?.token?.trim() ||
        ''
    );
}

function nodeRedServiceUserId(): string | undefined {
    const value =
        envStr('FM_NODE_RED_SERVICE_USER_ID', '').trim() ||
        configRc.serviceAccounts?.nodered?.userId?.trim() ||
        '';
    return value.length > 0 ? value : undefined;
}

function grafanaOrgId(): string | undefined {
    const value = envStr('FM_GRAFANA_ORG_ID', '').trim();
    return value.length > 0 ? value : undefined;
}

function grafanaPermissions(): string[] {
    return [...envCsv('FM_GRAFANA_PERMISSIONS', [])];
}

function grafanaServiceToken(): string {
    return (
        envStr('FM_GRAFANA_SERVICE_TOKEN', '').trim() ||
        configRc.serviceAccounts?.grafana?.token?.trim() ||
        ''
    );
}

function grafanaServiceUserId(): string | undefined {
    const value =
        envStr('FM_GRAFANA_SERVICE_USER_ID', '').trim() ||
        configRc.serviceAccounts?.grafana?.userId?.trim() ||
        '';
    return value.length > 0 ? value : undefined;
}

export const NODE_RED_USER: user_t = {
    username: 'fleet-nodered',
    password: '',
    permissions: nodeRedPermissions(),
    group: 'automation_service',
    enabled: false,
    roles: ['none'],
    organizationId: nodeRedOrgId(),
    userId: nodeRedServiceUserId()
};

export const GRAFANA_USER: user_t = {
    username: 'fleet-grafana',
    password: '',
    permissions: grafanaPermissions(),
    group: 'automation_service',
    enabled: false,
    roles: ['none'],
    organizationId: grafanaOrgId(),
    userId: grafanaServiceUserId()
};

export interface ServiceUserSource {
    label: string;
    username: string;
    serviceAccount: ServiceAccountConfig | undefined;
    orgId: string | undefined;
    fallbackPermissions: string[];
    fallbackUserId: string | undefined;
    tokenPresent: boolean;
}

export interface ResolvedServiceUser {
    user: user_t;
    /** false = static fallback identity; callers should retry resolution. */
    fromDirectory: boolean;
}

async function loadServiceUser(
    source: ServiceUserSource
): Promise<ResolvedServiceUser> {
    const fromDirectory = await tryLoadServiceUserFromDirectory(source);
    if (fromDirectory) return {user: fromDirectory, fromDirectory: true};
    return {user: buildFallbackServiceUser(source), fromDirectory: false};
}

async function tryLoadServiceUserFromDirectory(
    source: ServiceUserSource
): Promise<user_t | undefined> {
    if (!source.serviceAccount?.userId) return undefined;
    if (!identityDirectory.isManagementApiAvailable()) return undefined;
    try {
        const metadata = await identityDirectory.getServiceUserMetadata(
            source.serviceAccount.userId
        );
        return buildServiceUserFromMetadata(source, metadata.permissions);
    } catch (error) {
        logger.warn(
            'Failed to get %s service account metadata, using defaults: %s',
            source.label,
            error
        );
        return undefined;
    }
}

function buildServiceUserFromMetadata(
    source: ServiceUserSource,
    metadataPermissions: string[]
): user_t {
    return {
        username: source.username,
        password: '',
        permissions:
            metadataPermissions.length > 0
                ? metadataPermissions
                : source.fallbackPermissions,
        group: 'automation_service',
        enabled: true,
        roles: ['none'],
        organizationId: source.orgId,
        userId: source.serviceAccount?.userId
    };
}

export function buildFallbackServiceUser(source: ServiceUserSource): user_t {
    return {
        username: source.username,
        password: '',
        permissions: source.fallbackPermissions,
        group: 'automation_service',
        enabled: source.tokenPresent,
        roles: ['none'],
        organizationId: source.orgId,
        userId: source.serviceAccount?.userId ?? source.fallbackUserId
    };
}

export function getNodeRedServiceUser(): Promise<ResolvedServiceUser> {
    return loadServiceUser({
        label: 'Node-RED',
        username: 'fleet-nodered',
        serviceAccount: configRc.serviceAccounts?.nodered,
        orgId: nodeRedOrgId(),
        fallbackPermissions: nodeRedPermissions(),
        fallbackUserId: nodeRedServiceUserId(),
        tokenPresent: nodeRedServiceToken().length > 0
    });
}

export async function getGrafanaServiceUser(): Promise<user_t> {
    return (
        await loadServiceUser({
            label: 'Grafana',
            username: 'fleet-grafana',
            serviceAccount: configRc.serviceAccounts?.grafana,
            orgId: grafanaOrgId(),
            fallbackPermissions: grafanaPermissions(),
            fallbackUserId: grafanaServiceUserId(),
            tokenPresent: grafanaServiceToken().length > 0
        })
    ).user;
}

export function authenticateFleetUserToken(
    token: string | undefined
): Promise<user_t | undefined> {
    return createFleetUserTokenAuthenticator().authenticate(token);
}

function createFleetUserTokenAuthenticator(): TokenAuthenticator<user_t> {
    return new TokenAuthenticator<user_t>({
        isRejected: isTokenRejected,
        markRejected: markTokenRejected,
        getCachedUser: (token) => getCachedUser(token) ?? undefined,
        verifyScopedToken: ScopedTokenSigner.verify,
        loadScopedTokenUser: loadScopedPatUser,
        serviceTokenProviders: buildServiceTokenProviders(),
        cacheUser,
        isDevMode: () => DEV_MODE,
        getDevModeUser: getUserFromTokenDevMode,
        isExternalIdentityProviderConfigured: isZitadelConfigured,
        getInflightExternalAuth: getInflightIntrospection,
        registerInflightExternalAuth: registerInflightIntrospection,
        authenticateExternalToken: authenticateExternalOidcToken,
        incrementCounter: Observability.incrementCounter,
        warn: (message) => logger.warn(message),
        debug: (message) => logger.debug(message)
    });
}

function buildServiceTokenProviders(): ServiceTokenProvider<user_t>[] {
    return [
        {
            label: 'Node-RED',
            getToken: () => nodeRedServiceToken() || undefined,
            getUser: async () => (await getNodeRedServiceUser()).user,
            isEnabled: isServiceUserEnabled
        },
        {
            label: 'Grafana',
            getToken: () => grafanaServiceToken() || undefined,
            getUser: getGrafanaServiceUser,
            isEnabled: isServiceUserEnabled
        }
    ];
}

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

        const permissions = parseDevModePermissions(dbUser.permissions);
        const group = dbUser.group || 'user';
        const isAdmin = permissions.includes('*') || group === 'admin';

        logger.info(
            'Dev mode auth: user=%s, group=%s, permissions=%d',
            username,
            group,
            permissions.length
        );
        logDevModeFirstLogin({token, username});

        return {
            username,
            password: '',
            permissions,
            group,
            enabled: true,
            roles: [isAdmin ? FLEET_ROLES.ADMIN : FLEET_ROLES.VIEWER],
            // Share the org devices land in, so dev-mode sees its waiting room.
            organizationId: tuning.deviceIngress.defaultOrganizationId,
            userId: username
        };
    } catch (error) {
        logger.error('Dev mode auth error: %s', error);
        return undefined;
    }
}

function parseDevModePermissions(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value !== 'string') return [];

    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : [];
    } catch {
        return [];
    }
}

function logDevModeFirstLogin(input: {token: string; username: string}): void {
    if (!claimFirstLogin(input.token)) return;
    AuditLogger.logLogin(
        input.username,
        undefined,
        true,
        undefined,
        tuning.deviceIngress.defaultOrganizationId,
        input.username
    );
}

async function loadScopedPatUser(
    _token: string,
    tokenId: string
): Promise<user_t | undefined> {
    const row = await getActiveScopedPat(tokenId);
    if (!row) return undefined;

    const roleInfo = await identityDirectory.getProjectRoles({
        userId: row.userId,
        organizationId: row.tenantId
    });
    const mapped = mapRolesToPermissions(roleInfo.roles);
    const user: user_t = {
        username: row.userId,
        password: '',
        permissions: mapped.permissions,
        group: mapped.group,
        enabled: true,
        roles: roleInfo.roles,
        organizationId: row.tenantId,
        userId: row.userId,
        mfaPresent: false,
        credentialId: row.tokenId,
        credentialPurpose: row.purpose,
        credentialBoundary: row.boundaryScope,
        credentialAudience: row.audience
    };

    touchScopedPatLastUsedBestEffort(tokenId);
    Observability.incrementCounter('fm_scoped_pat_used');
    return user;
}

function touchScopedPatLastUsedBestEffort(tokenId: string): void {
    void touchScopedPatLastUsed(tokenId).catch((error) => {
        logger.debug(
            'scoped PAT last-used update failed for %s: %s',
            tokenId,
            error instanceof Error ? error.message : String(error)
        );
    });
}

function isServiceUserEnabled(user: user_t): boolean {
    return Boolean(user.enabled && user.organizationId);
}
