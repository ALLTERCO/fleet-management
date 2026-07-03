// Zitadel user domain: CRUD/lookup/lifecycle/metadata/machine-users/PATs,
// project-role authorizations, and administrator queries. Free functions over
// the facade's http context. Swappable sibling ops (getUserMetadata,
// listAuthorizationsForUser, getUserResourceOwner, setUserMetadata, deleteUser)
// route through `svc` so test method-swaps on the singleton stay visible.

import {DEV_MODE, runtimeMetadata} from '../../config';
import {fmPlatformAdminRole, zitadelListPageSize} from '../../config/zitadel';
import {
    authzRolePriorityIndex,
    type FleetRole
} from '../../types/api/authzCatalog';
import {isResourceNotFound, type RpcCallError} from '../../types/api/errors';
import {FLEET_ROLES, matchProviderRoleKey} from '../authz/coarse';
import {
    defaultPatExpirationDate,
    type FleetProjectRef,
    type FleetUserMetadata,
    METADATA_KEYS,
    validateId,
    type ZitadelHttpContext,
    type ZitadelUser,
    type ZitadelV2User,
    zitadelLogger
} from './zitadelHttp';

const logger = zitadelLogger;

// Synthetic admin returned by listUsers() when DEV_MODE is on and Zitadel
// isn't running. Lets the Share modal + seed Persona assignment work without
// a Zitadel container.
export const DEV_ADMIN_USER: ZitadelUser = {
    userId: 'dev-admin',
    userName: 'admin',
    email: 'admin@dev.local',
    firstName: 'Dev',
    lastName: 'Admin',
    displayName: 'Dev Admin',
    state: 'ACTIVE'
};

export interface CreateMachineUserParams {
    userName: string;
    name: string;
    description?: string;
    // FM tenant id stamped into metadata; omit for instance-shared (provider support).
    organizationId?: string;
}

export interface CreateMachineUserResult {
    userId: string;
    userName: string;
}

export interface PersonalAccessToken {
    tokenId: string;
    token: string;
    expirationDate?: string;
}

export interface FleetUserRoles {
    // Sorted by catalog priority; roles[0] is the priority pick.
    roles: FleetRole[];
    roleKeys: string[];
}

export interface ZitadelV2Authorization {
    id: string;
    project: {
        id: string;
        name?: string;
        organizationId: string;
    };
    organization?: {
        id?: string;
    };
    user: {
        id: string;
    };
    roles?: Array<{
        key: string;
    }>;
}

interface AuthorizationTarget {
    projectId: string;
    authorizationOrgId: string;
}

interface ProjectAuthorizationQuery {
    userId: string;
    projectId: string;
    authorizationOrgId?: string;
}

interface ProjectAuthorizationCommand {
    userId: string;
    roleKeys: string[];
    target: AuthorizationTarget;
}

// Sibling ops that tests swap on the singleton — must be reached via `svc`.
type UserFacade = ZitadelHttpContext & {
    getUserMetadata(userId: string): Promise<FleetUserMetadata>;
    listAuthorizationsForUser(
        userId: string
    ): Promise<ZitadelV2Authorization[]>;
    getUserResourceOwner(userId: string): Promise<string | null>;
    setUserMetadata(
        userId: string,
        metadata: Partial<FleetUserMetadata>
    ): Promise<void>;
    deleteUser(userId: string): Promise<void>;
};

// Serialize read-merge-write per target: UpdateAuthorization has no etag, so
// concurrent grants would lost-update. One process owns one org, so an
// in-process chain is the full fence.
const authorizationMutations = new Map<string, Promise<unknown>>();

function authorizationTargetKey(
    userId: string,
    target: AuthorizationTarget
): string {
    return [userId, target.projectId, target.authorizationOrgId].join('|');
}

async function withAuthorizationLock<T>(
    key: string,
    mutate: () => Promise<T>
): Promise<T> {
    const prior = authorizationMutations.get(key) ?? Promise.resolve();
    // Run after the prior mutation settles, regardless of its outcome, so one
    // failure never rejects the next queued mutation.
    const run = prior.then(mutate, mutate);
    // Settled-only view used purely for chaining; never rejects.
    const tail = run.then(
        () => undefined,
        () => undefined
    );
    authorizationMutations.set(key, tail);
    try {
        return await run;
    } finally {
        // Drop the key once this is the last queued mutation to bound the map.
        if (authorizationMutations.get(key) === tail) {
            authorizationMutations.delete(key);
        }
    }
}

async function getFleetProject(
    svc: ZitadelHttpContext
): Promise<FleetProjectRef> {
    return svc.getFleetProject();
}

export async function getFleetProjectId(
    svc: ZitadelHttpContext
): Promise<string> {
    return (await getFleetProject(svc)).projectId;
}

export async function listAuthorizationsForUser(
    svc: ZitadelHttpContext,
    userId: string
): Promise<ZitadelV2Authorization[]> {
    const response = await svc.request<{
        authorizations?: ZitadelV2Authorization[];
    }>(
        'POST',
        '/zitadel.authorization.v2.AuthorizationService/ListAuthorizations',
        {
            pagination: {limit: zitadelListPageSize()},
            filters: [{inUserIds: {ids: [userId]}}]
        }
    );

    return response.authorizations ?? [];
}

export async function getUserMetadata(
    svc: ZitadelHttpContext,
    userId: string
): Promise<FleetUserMetadata> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        logger.warn('Zitadel not configured, returning empty metadata');
        return {permissions: [], group: ''};
    }

    try {
        const response = await svc.request<{
            metadata?: Array<{key: string; value: string}>;
        }>('POST', `/v2/users/${userId}/metadata/search`, {});

        const metadata: FleetUserMetadata = {
            permissions: [],
            group: ''
        };

        if (response.metadata) {
            for (const item of response.metadata) {
                const decodedValue = Buffer.from(item.value, 'base64').toString(
                    'utf-8'
                );

                if (item.key === METADATA_KEYS.PERMISSIONS) {
                    try {
                        const parsed = JSON.parse(decodedValue);
                        if (
                            Array.isArray(parsed) &&
                            parsed.every((v) => typeof v === 'string')
                        ) {
                            metadata.permissions = parsed;
                        } else {
                            logger.warn(
                                'Invalid permissions metadata shape for user %s',
                                userId
                            );
                        }
                    } catch {
                        logger.warn(
                            'Invalid permissions metadata for user %s',
                            userId
                        );
                    }
                } else if (item.key === METADATA_KEYS.GROUP) {
                    metadata.group = decodedValue;
                } else if (item.key === METADATA_KEYS.ORGANIZATION_ID) {
                    metadata.organizationId = decodedValue;
                }
            }
        }

        return metadata;
    } catch (error) {
        logger.error('Failed to get user metadata for %s: %s', userId, error);
        return {permissions: [], group: ''};
    }
}

function authorizationOrganizationId(
    authorization: ZitadelV2Authorization
): string {
    return (
        authorization.organization?.id ?? authorization.project.organizationId
    );
}

async function resolveAuthorizationTarget(
    svc: ZitadelHttpContext,
    organizationId?: string
): Promise<AuthorizationTarget> {
    const project = await svc.getFleetProject();
    return {
        projectId: project.projectId,
        authorizationOrgId: organizationId ?? project.organizationId
    };
}

function authorizationMatchesTarget(
    authorization: ZitadelV2Authorization,
    target: AuthorizationTarget
): boolean {
    return (
        authorization.project.id === target.projectId &&
        authorizationOrganizationId(authorization) === target.authorizationOrgId
    );
}

async function findProjectAuthorization(
    svc: UserFacade,
    userId: string,
    target: AuthorizationTarget
): Promise<ZitadelV2Authorization | undefined> {
    const authorizations = await svc.listAuthorizationsForUser(userId);
    return authorizations.find((authorization) =>
        authorizationMatchesTarget(authorization, target)
    );
}

async function listProjectAuthorizations(
    svc: UserFacade,
    query: ProjectAuthorizationQuery
): Promise<ZitadelV2Authorization[]> {
    const authorizations = await svc.listAuthorizationsForUser(query.userId);
    return authorizations.filter(
        (authorization) =>
            authorization.project.id === query.projectId &&
            (query.authorizationOrgId === undefined ||
                authorizationOrganizationId(authorization) ===
                    query.authorizationOrgId)
    );
}

async function createProjectAuthorization(
    svc: ZitadelHttpContext,
    command: ProjectAuthorizationCommand
): Promise<void> {
    await svc.request(
        'POST',
        '/zitadel.authorization.v2.AuthorizationService/CreateAuthorization',
        {
            userId: command.userId,
            projectId: command.target.projectId,
            organizationId: command.target.authorizationOrgId,
            roleKeys: command.roleKeys
        }
    );
}

function authorizationRoleKeys(
    authorizations: ZitadelV2Authorization[]
): string[] {
    const roleKeys = authorizations.flatMap((authorization) =>
        (authorization.roles ?? []).map((role) => role.key.toLowerCase())
    );
    return [...new Set(roleKeys)];
}

// Diagnostic / admin only. Maps every catalog role + alias via the same
// matchRole logic auth uses, so no role drops out of the response.
// restrictToOrgId narrows to the authorization org. For granted projects,
// this can differ from the project owner org.
export async function getUserRoles(
    svc: UserFacade,
    userId: string,
    restrictToOrgId?: string
): Promise<FleetUserRoles> {
    validateId(userId, 'userId');
    const defaultRoles: FleetUserRoles = {
        roles: [FLEET_ROLES.NONE],
        roleKeys: []
    };

    if (!svc.isConfigured()) return defaultRoles;

    try {
        const project = await svc.getFleetProject();
        const authorizations = await listProjectAuthorizations(svc, {
            userId,
            projectId: project.projectId,
            authorizationOrgId: restrictToOrgId
        });
        const roleKeys = authorizationRoleKeys(authorizations);
        const roles = roleKeys.flatMap((roleKey) => {
            const matched = matchProviderRoleKey(roleKey);
            return matched ? [matched] : [];
        });

        const uniqueRoles = [...new Set(roles)].sort(
            (a, b) => authzRolePriorityIndex(a) - authzRolePriorityIndex(b)
        );
        return {
            roles: uniqueRoles.length > 0 ? uniqueRoles : [FLEET_ROLES.NONE],
            roleKeys
        };
    } catch (error) {
        logger.error('Failed to get user roles for %s: %s', userId, error);
        return defaultRoles;
    }
}

export async function setUserMetadata(
    svc: ZitadelHttpContext,
    userId: string,
    metadata: Partial<FleetUserMetadata>
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    const updates: Array<{key: string; value: string}> = [];

    if (metadata.permissions !== undefined) {
        updates.push({
            key: METADATA_KEYS.PERMISSIONS,
            value: Buffer.from(JSON.stringify(metadata.permissions)).toString(
                'base64'
            )
        });
    }

    if (metadata.group !== undefined) {
        updates.push({
            key: METADATA_KEYS.GROUP,
            value: Buffer.from(metadata.group).toString('base64')
        });
    }

    if (metadata.organizationId !== undefined) {
        updates.push({
            key: METADATA_KEYS.ORGANIZATION_ID,
            value: Buffer.from(metadata.organizationId).toString('base64')
        });
    }

    await svc.request('POST', `/v2/users/${userId}/metadata`, {
        metadata: updates
    });

    logger.info('Updated metadata for user %s', userId);
}

// List human users. tenantId narrows results to one Zitadel resourceOwner;
// pass undefined only from provider support paths.
export async function listUsers(
    svc: ZitadelHttpContext,
    tenantId?: string
): Promise<ZitadelUser[]> {
    if (!svc.isConfigured()) {
        return DEV_MODE ? [DEV_ADMIN_USER] : [];
    }

    const queries: Array<Record<string, unknown>> = [
        {typeQuery: {type: 'TYPE_HUMAN'}}
    ];
    if (tenantId) {
        queries.push({organizationIdQuery: {organizationId: tenantId}});
    }
    const response = await svc.request<{
        result?: ZitadelV2User[];
    }>('POST', '/v2/users', {
        query: {limit: zitadelListPageSize()},
        queries
    });

    return (response.result || []).map((user) => svc.normalizeUser(user));
}

// organizationId filters by metadata tag; omit for instance-wide (provider support).
export async function listMachineUsers(
    svc: UserFacade,
    organizationId?: string
): Promise<
    Array<{
        userId: string;
        userName: string;
        name: string;
        description?: string;
        organizationId?: string;
    }>
> {
    if (!svc.isConfigured()) return [];

    const response = await svc.request<{
        result?: ZitadelV2User[];
    }>('POST', '/v2/users', {
        query: {limit: zitadelListPageSize()},
        queries: [{typeQuery: {type: 'TYPE_MACHINE'}}]
    });

    const users = (response.result || []).map((u) => ({
        userId: u.id || u.userId || '',
        userName: u.username || u.userName || '',
        name: u.machine?.name || u.username || u.userName || '',
        description: u.machine?.description
    }));

    if (!organizationId) return users;

    // v2 list omits metadata; per-user fetch then filter (N+1, small N).
    const enriched = await Promise.all(
        users.map(async (u) => {
            try {
                const md = await svc.getUserMetadata(u.userId);
                return {...u, organizationId: md.organizationId};
            } catch {
                return {...u, organizationId: undefined};
            }
        })
    );
    return enriched.filter((u) => u.organizationId === organizationId);
}

export async function findUserByEmail(
    svc: ZitadelHttpContext,
    email: string
): Promise<ZitadelUser | null> {
    if (!svc.isConfigured()) {
        return null;
    }

    try {
        const response = await svc.request<{
            result?: ZitadelV2User[];
        }>('POST', '/v2/users', {
            query: {limit: 1},
            queries: [
                {
                    emailQuery: {
                        emailAddress: email,
                        method: 'TEXT_QUERY_METHOD_EQUALS'
                    }
                }
            ]
        });

        if (response.result && response.result.length > 0) {
            return svc.normalizeUser(response.result[0]);
        }

        return null;
    } catch (error) {
        logger.error('Failed to find user by email %s: %s', email, error);
        return null;
    }
}

export async function findUserByUsername(
    svc: ZitadelHttpContext,
    username: string
): Promise<ZitadelUser | null> {
    if (!svc.isConfigured()) {
        return null;
    }

    try {
        const response = await svc.request<{
            result?: ZitadelV2User[];
        }>('POST', '/v2/users', {
            query: {limit: 1},
            queries: [
                {
                    userNameQuery: {
                        userName: username,
                        method: 'TEXT_QUERY_METHOD_EQUALS'
                    }
                }
            ]
        });

        if (response.result && response.result.length > 0) {
            return svc.normalizeUser(response.result[0]);
        }

        return null;
    } catch (error) {
        logger.error('Failed to find user by username %s: %s', username, error);
        return null;
    }
}

// Returns the resourceOwner (org id), or null only for a definitive 404.
// Transient failures rethrow so null never silently means "outage".
export async function getUserResourceOwner(
    svc: ZitadelHttpContext,
    userId: string
): Promise<string | null> {
    if (!svc.isConfigured()) return null;
    validateId(userId, 'userId');
    try {
        const resp = await svc.request<{
            user?: {details?: {resourceOwner?: string}};
        }>('GET', `/v2/users/${userId}`);
        return resp.user?.details?.resourceOwner ?? null;
    } catch (err) {
        if (isResourceNotFound(err as RpcCallError)) return null;
        logger.error('getUserResourceOwner failed for %s: %s', userId, err);
        throw err;
    }
}

// Tenant gate. Humans match by resourceOwner; FM service users match
// by fleet_organization_id metadata. With no tenant authority, fail closed
// in multi-tenant (SaaS) modes; OSS is single-tenant so it may pass.
export async function userBelongsToTenant(
    svc: UserFacade,
    userId: string,
    tenantId: string
): Promise<boolean> {
    if (!svc.isConfigured()) return !tenantAuthorityRequired();
    const owner = await svc.getUserResourceOwner(userId);
    if (owner !== null && owner === tenantId) return true;
    const metadata = await svc.getUserMetadata(userId);
    return metadata.organizationId === tenantId;
}

// SSOT: runtimeMetadata.deploymentMode. SaaS modes are multi-tenant and
// require an external tenant authority; OSS is single-tenant and does not.
function tenantAuthorityRequired(): boolean {
    return runtimeMetadata.deploymentMode !== 'oss';
}

/**
 * Create a human user in Zitadel.
 *
 * tenantId: target Zitadel org. The user's resourceOwner becomes
 * this org id, which is the same value FM reads from the JWT to
 * map a request to a tenant. Pass the sender's organizationId so a
 * tenant admin's new users land in their tenant, not in the shared
 * fleet project org. Single-tenant deploys can pass the fleet
 * project org id (same value as sender.organizationId there).
 */
export async function createHumanUser(
    svc: ZitadelHttpContext,
    params: {
        email: string;
        userName: string;
        firstName: string;
        lastName: string;
        displayName?: string;
        password?: string;
        passwordChangeRequired?: boolean;
        tenantId: string;
    }
): Promise<{userId: string}> {
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    // If the operator provided a password, they want the user to log in
    // immediately — so mark the email verified. Without this Zitadel
    // blocks first login with a generic 'unknown error'. Password-less
    // creates still go via the email-verification + reset flow.
    const emailField: Record<string, unknown> = {email: params.email};
    if (params.password) {
        emailField.isVerified = true;
    }
    const body: Record<string, unknown> = {
        organizationId: params.tenantId,
        username: params.userName,
        human: {
            profile: {
                givenName: params.firstName,
                familyName: params.lastName,
                displayName:
                    params.displayName ||
                    `${params.firstName} ${params.lastName}`
            },
            email: emailField
        }
    };

    if (params.password) {
        (body.human as Record<string, unknown>).password = {
            password: params.password,
            changeRequired: params.passwordChangeRequired ?? true
        };
    }

    const response = await svc.request<{id: string}>(
        'POST',
        '/v2/users/new',
        body
    );

    logger.info(
        'Created human user %s with ID %s',
        params.userName,
        response.id
    );
    return {userId: response.id};
}

export async function createMachineUser(
    svc: UserFacade,
    params: CreateMachineUserParams
): Promise<CreateMachineUserResult> {
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    const project = await svc.getFleetProject();
    const machine: Record<string, unknown> = {
        name: params.name,
        accessTokenType: 'ACCESS_TOKEN_TYPE_BEARER'
    };
    // proto: description is optional, but min_len:1 when set — drop if blank.
    const description = params.description?.trim();
    if (description) {
        machine.description = description;
    }
    const response = await svc.request<{id: string}>('POST', '/v2/users/new', {
        organizationId: project.organizationId,
        username: params.userName,
        machine
    });

    if (params.organizationId) {
        try {
            await svc.setUserMetadata(response.id, {
                organizationId: params.organizationId
            });
        } catch (err) {
            // Un-tagged users are invisible to their tenant admin but
            // visible to provider support — orphan rollback so the half-created
            // user can't be claimed into a foreign tenant later.
            logger.error(
                'Failed to stamp organizationId metadata on machine user %s; rolling back: %s',
                response.id,
                err
            );
            try {
                await svc.deleteUser(response.id);
            } catch (cleanupErr) {
                logger.error(
                    'Orphan rollback failed for machine user %s; manual cleanup required: %s',
                    response.id,
                    cleanupErr
                );
            }
            throw err;
        }
    }

    logger.info(
        'Created machine user %s with ID %s (org=%s)',
        params.userName,
        response.id,
        params.organizationId ?? '<instance>'
    );

    return {
        userId: response.id,
        userName: params.userName
    };
}

export async function createPersonalAccessToken(
    svc: ZitadelHttpContext,
    userId: string,
    expirationDate?: Date
): Promise<PersonalAccessToken> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    const effectiveExpirationDate =
        expirationDate ?? defaultPatExpirationDate();
    const body = {expirationDate: effectiveExpirationDate.toISOString()};

    const response = await svc.request<{
        tokenId: string;
        token: string;
    }>('POST', `/v2/users/${userId}/pats`, body);

    logger.info('Created PAT for user %s', userId);

    return {
        tokenId: response.tokenId,
        token: response.token,
        expirationDate: effectiveExpirationDate.toISOString()
    };
}

export async function listPersonalAccessTokens(
    svc: ZitadelHttpContext,
    userId: string
): Promise<
    Array<{tokenId: string; expirationDate?: string; creationDate?: string}>
> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) throw new Error('Zitadel not configured');
    const response = await svc.request<{
        result?: Array<{
            id: string;
            userId?: string;
            expirationDate?: string;
            creationDate?: string;
        }>;
    }>('POST', '/v2/users/pats/search', {
        pagination: {limit: zitadelListPageSize()},
        filters: [
            {
                userIdFilter: {
                    id: userId,
                    method: 'TEXT_FILTER_METHOD_EQUALS'
                }
            }
        ]
    });
    return (response.result ?? []).map((t) => ({
        tokenId: t.id,
        expirationDate: t.expirationDate,
        creationDate: t.creationDate
    }));
}

export async function revokePersonalAccessToken(
    svc: ZitadelHttpContext,
    userId: string,
    tokenId: string
): Promise<void> {
    validateId(userId, 'userId');
    validateId(tokenId, 'tokenId');
    if (!svc.isConfigured()) throw new Error('Zitadel not configured');
    await svc.request('DELETE', `/v2/users/${userId}/pats/${tokenId}`);
    logger.info('Revoked PAT %s for user %s', tokenId, userId);
}

/**
 * Grant a project role to a user.
 * Finds the FM project by name, then grants the specified roles.
 */
export async function grantProjectRole(
    svc: ZitadelHttpContext,
    userId: string,
    roleKeys: string[],
    organizationId?: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) throw new Error('Zitadel not configured');

    const target = await resolveAuthorizationTarget(svc, organizationId);
    await createProjectAuthorization(svc, {userId, roleKeys, target});
    logger.info(
        'Granted roles %s to user %s on project %s org %s',
        roleKeys.join(','),
        userId,
        target.projectId,
        target.authorizationOrgId
    );
}

export async function ensureProjectRoles(
    svc: UserFacade,
    userId: string,
    roleKeys: string[],
    organizationId?: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) throw new Error('Zitadel not configured');

    const target = await resolveAuthorizationTarget(svc, organizationId);
    const wanted = Array.from(new Set(roleKeys));
    await withAuthorizationLock(authorizationTargetKey(userId, target), () =>
        applyEnsureProjectRoles(svc, userId, wanted, target)
    );
}

async function applyEnsureProjectRoles(
    svc: UserFacade,
    userId: string,
    wanted: string[],
    target: AuthorizationTarget
): Promise<void> {
    const authorization = await findProjectAuthorization(svc, userId, target);
    if (!authorization) {
        await createProjectAuthorization(svc, {
            userId,
            roleKeys: wanted,
            target
        });
        logger.info(
            'Granted roles %s to user %s on project %s org %s',
            wanted.join(','),
            userId,
            target.projectId,
            target.authorizationOrgId
        );
        return;
    }

    const existing = authorization.roles?.map((role) => role.key) ?? [];
    const merged = Array.from(new Set([...existing, ...wanted]));
    const hasAll = wanted.every((role) => existing.includes(role));
    if (hasAll) return;

    await svc.request(
        'POST',
        '/zitadel.authorization.v2.AuthorizationService/UpdateAuthorization',
        {
            id: authorization.id,
            roleKeys: merged
        }
    );
    logger.info(
        'Ensured roles %s for user %s on project %s org %s',
        wanted.join(','),
        userId,
        target.projectId,
        target.authorizationOrgId
    );
}

/**
 * Subtractive counterpart to ensureProjectRoles. UPDATE if any roles
 * remain, DELETE the authorization entirely if not. No-op if the user
 * has no authorization or none of the requested roles.
 */
export async function removeProjectRoles(
    svc: UserFacade,
    userId: string,
    roleKeys: string[],
    organizationId?: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) throw new Error('Zitadel not configured');
    if (roleKeys.length === 0) return;

    const target = await resolveAuthorizationTarget(svc, organizationId);
    await withAuthorizationLock(authorizationTargetKey(userId, target), () =>
        applyRemoveProjectRoles(svc, userId, roleKeys, target)
    );
}

async function applyRemoveProjectRoles(
    svc: UserFacade,
    userId: string,
    roleKeys: string[],
    target: AuthorizationTarget
): Promise<void> {
    const toRemove = new Set(roleKeys);
    const authorization = await findProjectAuthorization(svc, userId, target);
    if (!authorization) return;

    const existing = authorization.roles?.map((role) => role.key) ?? [];
    const remaining = existing.filter((k) => !toRemove.has(k));
    if (remaining.length === existing.length) return;

    if (remaining.length === 0) {
        await svc.request(
            'POST',
            '/zitadel.authorization.v2.AuthorizationService/DeleteAuthorization',
            {id: authorization.id}
        );
        logger.info(
            'Deleted authorization for user %s on project %s org %s (no roles left)',
            userId,
            target.projectId,
            target.authorizationOrgId
        );
        return;
    }

    await svc.request(
        'POST',
        '/zitadel.authorization.v2.AuthorizationService/UpdateAuthorization',
        {id: authorization.id, roleKeys: remaining}
    );
    logger.info(
        'Removed roles %s from user %s on project %s org %s',
        roleKeys.join(','),
        userId,
        target.projectId,
        target.authorizationOrgId
    );
}

export async function sendPasswordResetEmail(
    svc: ZitadelHttpContext,
    userId: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    await svc.request('POST', `/v2/users/${userId}/password_reset`, {
        sendLink: {
            notificationType: 'NOTIFICATION_TYPE_Email'
        }
    });

    logger.info('Sent password reset email to user %s', userId);
}

export async function updateHumanProfile(
    svc: ZitadelHttpContext,
    userId: string,
    profile: {firstName: string; lastName: string; displayName?: string}
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    await svc.request('PATCH', `/v2/users/${userId}`, {
        human: {
            profile: {
                givenName: profile.firstName,
                familyName: profile.lastName,
                displayName:
                    profile.displayName ||
                    `${profile.firstName} ${profile.lastName}`
            }
        }
    });

    logger.info('Updated profile for user %s', userId);
}

export async function updateHumanEmail(
    svc: ZitadelHttpContext,
    userId: string,
    email: string,
    isVerified = false
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    // Default = omit verification oneof (v1 parity: no email, stays unverified).
    // isVerified=true sets the verified flag explicitly.
    const emailBody: Record<string, unknown> = {email};
    if (isVerified) {
        emailBody.isVerified = true;
    }

    await svc.request('PATCH', `/v2/users/${userId}`, {
        human: {email: emailBody}
    });

    logger.info('Updated email for user %s', userId);
}

export async function removeUserMetadata(
    svc: ZitadelHttpContext,
    userId: string,
    key: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) {
        throw new Error('Invalid metadata key format');
    }
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    await svc.request(
        'DELETE',
        `/v2/users/${userId}/metadata?keys=${encodeURIComponent(key)}`
    );

    logger.info('Removed metadata %s for user %s', key, userId);
}

export async function deactivateUser(
    svc: ZitadelHttpContext,
    userId: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    await svc.request('POST', `/v2/users/${userId}/deactivate`, {});

    logger.info('Deactivated user %s', userId);
}

export async function reactivateUser(
    svc: ZitadelHttpContext,
    userId: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    await svc.request('POST', `/v2/users/${userId}/reactivate`, {});

    logger.info('Reactivated user %s', userId);
}

// Hard-delete: irreversible. audit_log keeps the row but loses Zitadel
// metadata. Caller must scrub FM-side state (PATs, cached user_t).
export async function deleteUser(
    svc: ZitadelHttpContext,
    userId: string
): Promise<void> {
    validateId(userId, 'userId');
    if (!svc.isConfigured()) {
        throw new Error('Zitadel not configured');
    }

    await svc.request('DELETE', `/v2/users/${userId}`);

    logger.info('Deleted user %s', userId);
}

export interface AdministratorRecord {
    userId: string;
    preferredLoginName?: string;
    organizationId?: string;
    organizationName?: string;
    roles: string[];
    creationDate?: string;
}

export async function listOrganizationAdministrators(
    svc: ZitadelHttpContext,
    organizationId: string
): Promise<AdministratorRecord[]> {
    if (!organizationId) return [];
    return listAdministratorsByQuery(svc, {
        pagination: {limit: zitadelListPageSize()},
        filters: [{resource: {organizationId}}]
    });
}

export async function hasInstanceAdministratorRole(
    svc: ZitadelHttpContext,
    userId: string,
    roleKey = fmPlatformAdminRole()
): Promise<boolean> {
    if (!userId || !roleKey) return false;
    try {
        const admins = await listInstanceAdministratorsForUserRole(svc, {
            userId,
            roleKey
        });
        return admins.some(
            (admin) => admin.userId === userId && admin.roles.includes(roleKey)
        );
    } catch (error) {
        logger.warn(
            'Could not verify Zitadel instance administrator status: %s',
            error
        );
        return false;
    }
}

async function listInstanceAdministratorsForUserRole(
    svc: ZitadelHttpContext,
    input: {
        userId: string;
        roleKey: string;
    }
): Promise<AdministratorRecord[]> {
    return listAdministratorsByQuery(svc, {
        pagination: {limit: 1},
        filters: [
            {resource: {instance: true}},
            {inUserIdsFilter: {ids: [input.userId]}},
            {role: {roleKey: input.roleKey}}
        ]
    });
}

async function listAdministratorsByQuery(
    svc: ZitadelHttpContext,
    query: {
        pagination: {limit: number};
        filters?: Array<
            | {
                  resource: {organizationId: string} | {instance: true};
              }
            | {
                  inUserIdsFilter: {ids: string[]};
              }
            | {
                  role: {roleKey: string};
              }
        >;
    }
): Promise<AdministratorRecord[]> {
    if (!svc.isConfigured()) return [];
    const response = await svc.request<{
        administrators?: Array<{
            creationDate?: string;
            user: {
                id: string;
                preferredLoginName?: string;
                organizationId?: string;
            };
            organization?: {id: string; name?: string};
            roles?: string[];
        }>;
    }>(
        'POST',
        '/zitadel.internal_permission.v2.InternalPermissionService/ListAdministrators',
        query
    );
    return (response.administrators ?? []).map((a) => ({
        userId: a.user.id,
        preferredLoginName: a.user.preferredLoginName,
        organizationId: a.organization?.id,
        organizationName: a.organization?.name,
        roles: a.roles ?? [],
        creationDate: a.creationDate
    }));
}
