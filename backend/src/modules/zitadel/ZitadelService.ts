import {getLogger} from 'log4js';
import {configRc} from '../../config';

const logger = getLogger('zitadel');

// Metadata keys used for Fleet Manager
export const METADATA_KEYS = {
    PERMISSIONS: 'fleet_permissions',
    GROUP: 'fleet_group'
} as const;

// Fleet Manager role definitions
export const FLEET_ROLES = {
    ADMIN: 'admin',
    VIEWER: 'viewer',
    INSTALLER: 'installer',
    NONE: 'none'
} as const;

export type FleetRole = (typeof FLEET_ROLES)[keyof typeof FLEET_ROLES];

// Role to permissions mapping
export const ROLE_PERMISSIONS: Record<FleetRole, string[]> = {
    [FLEET_ROLES.ADMIN]: ['*'],
    [FLEET_ROLES.VIEWER]: ['read:*'],
    [FLEET_ROLES.INSTALLER]: ['read:*', 'waitingroom:*'],
    [FLEET_ROLES.NONE]: []
};

/**
 * Extract Fleet Manager roles from JWT token claims.
 * Supports multiple Zitadel claim formats:
 * - urn:zitadel:iam:org:project:roles (object map with role keys)
 * - urn:zitadel:iam:org:project:{projectId}:roles (project-specific roles)
 * - roles (array of role strings)
 * - role (single role string)
 *
 * @param claims - The JWT token claims object
 * @returns Object containing extracted roles and the claim key used
 */
export function extractRolesFromClaims(claims: Record<string, unknown>): {
    roles: FleetRole[];
    primaryRole: FleetRole;
    claimKeyUsed: string | null;
} {
    // Default to NONE (no permissions) when no roles found
    const defaultResult = {
        roles: [] as FleetRole[],
        primaryRole: FLEET_ROLES.NONE as FleetRole,
        claimKeyUsed: null as string | null
    };

    if (!claims || typeof claims !== 'object') {
        return defaultResult;
    }

    const extractedRoles: FleetRole[] = [];
    let claimKeyUsed: string | null = null;

    // Helper to normalize and match role names
    const matchRole = (roleKey: string): FleetRole | null => {
        const normalized = roleKey.toLowerCase().trim();
        if (
            normalized === FLEET_ROLES.ADMIN ||
            normalized === 'administrator'
        ) {
            return FLEET_ROLES.ADMIN;
        }
        if (normalized === FLEET_ROLES.INSTALLER || normalized === 'install') {
            return FLEET_ROLES.INSTALLER;
        }
        if (
            normalized === FLEET_ROLES.VIEWER ||
            normalized === 'read' ||
            normalized === 'readonly'
        ) {
            return FLEET_ROLES.VIEWER;
        }
        return null;
    };

    // Helper to extract roles from a value (handles object maps, arrays, strings)
    const extractFromValue = (value: unknown, key: string): boolean => {
        if (!value) return false;

        // Object map format: { "admin": {...}, "viewer": {...} } or { "admin": true }
        if (typeof value === 'object' && !Array.isArray(value)) {
            const roleKeys = Object.keys(value as object);
            for (const roleKey of roleKeys) {
                const matched = matchRole(roleKey);
                if (matched) {
                    extractedRoles.push(matched);
                    claimKeyUsed = key;
                }
            }
            return extractedRoles.length > 0;
        }

        // Array format: ["admin", "viewer"]
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'string') {
                    const matched = matchRole(item);
                    if (matched) {
                        extractedRoles.push(matched);
                        claimKeyUsed = key;
                    }
                }
            }
            return extractedRoles.length > 0;
        }

        // String format: "admin"
        if (typeof value === 'string') {
            const matched = matchRole(value);
            if (matched) {
                extractedRoles.push(matched);
                claimKeyUsed = key;
                return true;
            }
        }

        return false;
    };

    // 1. Check standard Zitadel project roles claim
    const zitadelRolesClaim = 'urn:zitadel:iam:org:project:roles';
    if (claims[zitadelRolesClaim]) {
        extractFromValue(claims[zitadelRolesClaim], zitadelRolesClaim);
    }

    // 2. Check for project-specific role claims (urn:zitadel:iam:org:project:{projectId}:roles)
    if (extractedRoles.length === 0) {
        for (const key of Object.keys(claims)) {
            if (
                key.startsWith('urn:zitadel:iam:org:project:') &&
                key.endsWith(':roles')
            ) {
                if (extractFromValue(claims[key], key)) {
                    break;
                }
            }
        }
    }

    // 3. Check 'roles' claim (array)
    if (extractedRoles.length === 0 && claims.roles) {
        extractFromValue(claims.roles, 'roles');
    }

    // 4. Check 'role' claim (string or array)
    if (extractedRoles.length === 0 && claims.role) {
        extractFromValue(claims.role, 'role');
    }

    // 5. Check resource_access for Keycloak-style claims (if migrated)
    if (extractedRoles.length === 0 && claims.resource_access) {
        const resourceAccess = claims.resource_access as Record<
            string,
            unknown
        >;
        for (const resource of Object.values(resourceAccess)) {
            if (
                resource &&
                typeof resource === 'object' &&
                'roles' in (resource as object)
            ) {
                if (
                    extractFromValue(
                        (resource as {roles: unknown}).roles,
                        'resource_access'
                    )
                ) {
                    break;
                }
            }
        }
    }

    // Remove duplicates
    const uniqueRoles = [...new Set(extractedRoles)];

    // Determine primary role (admin takes precedence, default to NONE if no roles)
    let primaryRole: FleetRole = FLEET_ROLES.NONE;
    if (uniqueRoles.includes(FLEET_ROLES.ADMIN)) {
        primaryRole = FLEET_ROLES.ADMIN;
    } else if (uniqueRoles.includes(FLEET_ROLES.INSTALLER)) {
        primaryRole = FLEET_ROLES.INSTALLER;
    } else if (uniqueRoles.includes(FLEET_ROLES.VIEWER)) {
        primaryRole = FLEET_ROLES.VIEWER;
    } else if (uniqueRoles.length > 0) {
        primaryRole = uniqueRoles[0];
    }

    return {
        roles: uniqueRoles.length > 0 ? uniqueRoles : [FLEET_ROLES.NONE],
        primaryRole,
        claimKeyUsed
    };
}

/**
 * Permission configuration schema stored in Zitadel user metadata.
 * This is the primary source of permissions when available.
 */
export interface FleetPermissionConfig {
    /** Schema version for future evolution */
    version: number;
    /** Permission strings (e.g., "Device.*", "Entity.List") */
    permissions: string[];
    /** Device group IDs the user has access to */
    groups: number[];
    /** Individual device IDs (shellyID) the user has access to */
    devices: string[];
}

/** Metadata key for storing permission config in Zitadel */
export const FM_PERMISSIONS_KEY = 'fm_permissions';

/**
 * Extract Fleet Manager permission config from JWT token claims or metadata.
 * Looks for the fm_permissions claim which contains JSON configuration.
 *
 * Zitadel stores user metadata in claims with the format:
 * - urn:zitadel:iam:user:metadata:{key} (base64 encoded value)
 * - Or directly as fm_permissions if configured
 *
 * Supports both OLD format (version/permissions/groups/devices) and
 * NEW CRUD format (components with CRUD+E permissions).
 *
 * @param claims - The JWT token claims object
 * @returns The parsed permission config and metadata about extraction, or null if not found
 */
export function extractPermissionConfigFromClaims(
    claims: Record<string, unknown>
): {
    config: FleetPermissionConfig | Record<string, unknown> | null;
    source: string | null;
    error: string | null;
    isCrudFormat?: boolean;
} {
    const result = {
        config: null as FleetPermissionConfig | Record<string, unknown> | null,
        source: null as string | null,
        error: null as string | null,
        isCrudFormat: undefined as boolean | undefined
    };

    if (!claims || typeof claims !== 'object') {
        return result;
    }

    // Try different claim locations where Zitadel might put user metadata

    // 1. Direct fm_permissions claim (if configured to include in token)
    if (claims[FM_PERMISSIONS_KEY]) {
        const parsed = parsePermissionConfig(
            claims[FM_PERMISSIONS_KEY],
            FM_PERMISSIONS_KEY
        );
        if (parsed.config) {
            return {
                config: parsed.config,
                source: parsed.source,
                error: parsed.error,
                isCrudFormat: parsed.isCrudFormat
            };
        }
        if (parsed.error) {
            result.error = parsed.error;
        }
    }

    // 2. Zitadel metadata claim format: urn:zitadel:iam:user:metadata:{key}
    const zitadelMetadataKey = `urn:zitadel:iam:user:metadata:${FM_PERMISSIONS_KEY}`;
    if (claims[zitadelMetadataKey]) {
        // Zitadel encodes metadata values as base64
        const value = claims[zitadelMetadataKey];
        if (typeof value === 'string') {
            try {
                const decoded = Buffer.from(value, 'base64').toString('utf-8');
                const parsed = parsePermissionConfig(
                    JSON.parse(decoded),
                    zitadelMetadataKey
                );
                if (parsed.config) {
                    return {
                        config: parsed.config,
                        source: parsed.source,
                        error: parsed.error,
                        isCrudFormat: parsed.isCrudFormat
                    };
                }
                if (parsed.error) {
                    result.error = parsed.error;
                }
            } catch (e) {
                result.error = `Failed to decode base64 metadata from ${zitadelMetadataKey}`;
            }
        }
    }

    // 3. Check in a generic metadata object if present
    if (claims.metadata && typeof claims.metadata === 'object') {
        const metadata = claims.metadata as Record<string, unknown>;
        if (metadata[FM_PERMISSIONS_KEY]) {
            const parsed = parsePermissionConfig(
                metadata[FM_PERMISSIONS_KEY],
                'metadata.fm_permissions'
            );
            if (parsed.config) {
                return {
                    config: parsed.config,
                    source: parsed.source,
                    error: parsed.error,
                    isCrudFormat: parsed.isCrudFormat
                };
            }
            if (parsed.error) {
                result.error = parsed.error;
            }
        }
    }

    return result;
}

/**
 * Parse and validate a permission config value.
 * Supports both OLD format (version/permissions/groups/devices) and
 * NEW CRUD format (components with CRUD+E permissions).
 */
function parsePermissionConfig(
    value: unknown,
    source: string
): {
    config: FleetPermissionConfig | Record<string, unknown> | null;
    source: string | null;
    error: string | null;
    isCrudFormat?: boolean;
} {
    try {
        let config: unknown;

        // Handle string (might be JSON string or base64-encoded JSON)
        if (typeof value === 'string') {
            try {
                config = JSON.parse(value);
            } catch {
                // Zitadel metadata values are base64-encoded — try decoding
                const decoded = Buffer.from(value, 'base64').toString('utf-8');
                config = JSON.parse(decoded);
            }
        } else {
            config = value;
        }

        // Validate structure
        if (!config || typeof config !== 'object') {
            return {
                config: null,
                source: null,
                error: `Invalid config structure from ${source}`
            };
        }

        const obj = config as Record<string, unknown>;

        // Check if this is the NEW CRUD format (has 'components' key)
        if (obj.components && typeof obj.components === 'object') {
            logger.info('Detected CRUD format permissions from %s', source);
            // Return as-is for the caller to handle with the new permission model
            return {
                config: obj,
                source,
                error: null,
                isCrudFormat: true
            };
        }

        // OLD format: Check version
        if (typeof obj.version !== 'number' || obj.version < 1) {
            return {
                config: null,
                source: null,
                error: `Invalid or missing version in ${source}`
            };
        }

        // Validate and normalize permissions
        const permissions: string[] = [];
        if (Array.isArray(obj.permissions)) {
            for (const p of obj.permissions) {
                if (typeof p === 'string' && p.length > 0) {
                    permissions.push(p);
                }
            }
        }

        // Validate and normalize groups
        const groups: number[] = [];
        if (Array.isArray(obj.groups)) {
            for (const g of obj.groups) {
                if (typeof g === 'number') {
                    groups.push(g);
                }
            }
        }

        // Validate and normalize devices
        const devices: string[] = [];
        if (Array.isArray(obj.devices)) {
            for (const d of obj.devices) {
                if (typeof d === 'string' && d.length > 0) {
                    devices.push(d);
                }
            }
        }

        return {
            config: {
                version: obj.version as number,
                permissions,
                groups,
                devices
            },
            source,
            error: null,
            isCrudFormat: false
        };
    } catch (e) {
        return {
            config: null,
            source: null,
            error: `Failed to parse config from ${source}: ${e}`
        };
    }
}

/**
 * Convert a FleetPermissionConfig into a flat permissions array
 * suitable for use with CommandSender.
 */
export function permissionConfigToPermissions(
    config: FleetPermissionConfig
): string[] {
    const result: string[] = [...config.permissions];

    // Add group permissions
    for (const groupId of config.groups) {
        result.push(`Group.get.${groupId}`);
    }

    // Add device permissions
    for (const deviceId of config.devices) {
        result.push(`Device.get.${deviceId}`);
    }

    return result;
}

/**
 * Determine the group/role from a permission config.
 * If permissions include '*' or many write permissions, treat as admin.
 * Otherwise treat as a custom role.
 */
export function permissionConfigToGroup(config: FleetPermissionConfig): string {
    // Check for full admin access
    if (config.permissions.includes('*')) {
        return 'admin';
    }

    // Check for any wildcard permissions that indicate elevated access
    const hasWildcards = config.permissions.some((p) => p.endsWith('.*'));
    const hasWritePerms = config.permissions.some(
        (p) =>
            p.includes('Create') ||
            p.includes('Update') ||
            p.includes('Delete') ||
            p.includes('Call')
    );

    if (hasWildcards && hasWritePerms) {
        return 'power-user';
    }

    if (hasWritePerms) {
        return 'user';
    }

    return 'viewer';
}

export interface FleetUserMetadata {
    permissions: string[];
    group: string;
}

export interface FleetUserRoles {
    roles: FleetRole[];
    primaryRole: FleetRole;
}

export interface ZitadelUser {
    userId: string;
    userName: string;
    email?: string;
    displayName?: string;
    state?: string;
}

export interface CreateMachineUserParams {
    userName: string;
    name: string;
    description?: string;
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

class ZitadelService {
    private baseUrl: string;
    private serviceToken: string | null = null;

    constructor() {
        const oidcConfig = configRc.oidc?.backend;
        if (!oidcConfig) {
            logger.warn(
                'Zitadel OIDC config not found - service will be disabled'
            );
            this.baseUrl = '';
            return;
        }

        // Use authority as the base URL
        if (oidcConfig.authority) {
            this.baseUrl = oidcConfig.authority;
        } else {
            logger.error(
                'Cannot determine Zitadel base URL - authority not set'
            );
            this.baseUrl = '';
        }

        // Service token (PAT) for Management API access — created by bootstrap
        if (oidcConfig.serviceToken) {
            this.serviceToken = oidcConfig.serviceToken;
            logger.info(
                'ZitadelService initialized with base URL: %s (service token: configured)',
                this.baseUrl
            );
        } else {
            logger.info(
                'ZitadelService initialized with base URL: %s (no service token — metadata API disabled)',
                this.baseUrl
            );
        }
    }

    private isConfigured(): boolean {
        return this.baseUrl.length > 0;
    }

    /**
     * Get the service token (PAT) for Management API calls.
     *
     * The PAT is a Personal Access Token created for a dedicated machine user
     * during Zitadel bootstrap. It doesn't expire (or has a very long expiry)
     * and can be used directly as a Bearer token.
     *
     * This replaces the old client_credentials approach which doesn't work
     * with Zitadel API applications (they can only do token introspection).
     */
    private getServiceToken(): string {
        if (!this.serviceToken) {
            throw new Error(
                'No service token configured. Run bootstrap-zitadel.sh to create a service user with a PAT.'
            );
        }
        return this.serviceToken;
    }

    /**
     * Make an authenticated request to Zitadel Management API
     */
    private async request<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {
        const token = this.getServiceToken();

        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                Accept: 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const text = await response.text();
            logger.error('Zitadel API error [%s %s]: %s', method, path, text);
            throw new Error(`Zitadel API error: ${response.status} - ${text}`);
        }

        // Handle empty responses
        const contentLength = response.headers.get('content-length');
        if (contentLength === '0' || response.status === 204) {
            return {} as T;
        }

        return response.json() as Promise<T>;
    }

    /**
     * Get user metadata by user ID
     */
    async getUserMetadata(userId: string): Promise<FleetUserMetadata> {
        if (!this.isConfigured()) {
            logger.warn('Zitadel not configured, returning empty metadata');
            return {permissions: [], group: ''};
        }

        try {
            const response = await this.request<{
                result?: Array<{key: string; value: string}>;
            }>('POST', `/management/v1/users/${userId}/metadata/_search`, {});

            const metadata: FleetUserMetadata = {
                permissions: [],
                group: ''
            };

            if (response.result) {
                for (const item of response.result) {
                    // Zitadel returns metadata values as base64 encoded
                    const decodedValue = Buffer.from(
                        item.value,
                        'base64'
                    ).toString('utf-8');

                    if (item.key === METADATA_KEYS.PERMISSIONS) {
                        try {
                            metadata.permissions = JSON.parse(decodedValue);
                        } catch {
                            logger.warn(
                                'Invalid permissions metadata for user %s',
                                userId
                            );
                        }
                    } else if (item.key === METADATA_KEYS.GROUP) {
                        metadata.group = decodedValue;
                    }
                }
            }

            return metadata;
        } catch (error) {
            logger.error(
                'Failed to get user metadata for %s: %s',
                userId,
                error
            );
            return {permissions: [], group: ''};
        }
    }

    /**
     * Get fm_permissions metadata for a user.
     * Returns the parsed FleetPermissionConfig or null if not found.
     */
    async getFmPermissions(
        userId: string
    ): Promise<FleetPermissionConfig | null> {
        if (!this.isConfigured()) {
            return null;
        }

        try {
            const response = await this.request<{
                result?: Array<{key: string; value: string}>;
            }>('POST', `/management/v1/users/${userId}/metadata/_search`, {});

            if (response.result) {
                for (const item of response.result) {
                    if (item.key === FM_PERMISSIONS_KEY) {
                        try {
                            const decodedValue = Buffer.from(
                                item.value,
                                'base64'
                            ).toString('utf-8');
                            return JSON.parse(
                                decodedValue
                            ) as FleetPermissionConfig;
                        } catch (e) {
                            logger.warn(
                                'Failed to parse fm_permissions for user %s: %s',
                                userId,
                                e
                            );
                            return null;
                        }
                    }
                }
            }

            return null;
        } catch (error) {
            logger.debug(
                'Failed to get fm_permissions for %s: %s',
                userId,
                error
            );
            return null;
        }
    }

    /**
     * Get user roles from Zitadel project grants via Management API.
     * Returns the roles assigned to the user in the Fleet Manager project.
     *
     * @deprecated This method is NO LONGER USED for normal authentication.
     * Roles are now extracted directly from JWT claims using extractRolesFromClaims().
     * This method requires a valid service account with Management API access.
     * It is kept for potential admin/diagnostic use cases only.
     */
    async getUserRoles(userId: string): Promise<FleetUserRoles> {
        const defaultRoles: FleetUserRoles = {
            roles: [FLEET_ROLES.NONE],
            primaryRole: FLEET_ROLES.NONE
        };

        if (!this.isConfigured()) {
            logger.warn('Zitadel not configured, defaulting to no role');
            return defaultRoles;
        }

        try {
            logger.info('Fetching roles for user %s', userId);

            // Fetch user grants (project role assignments)
            const response = await this.request<{
                result?: Array<{
                    grantId: string;
                    userId: string;
                    projectId: string;
                    projectName: string;
                    roleKeys: string[];
                }>;
            }>('POST', `/management/v1/users/${userId}/grants/_search`, {});

            logger.info(
                'User grants response: %s',
                JSON.stringify(response, null, 2)
            );

            const roles: FleetRole[] = [];

            if (response.result && response.result.length > 0) {
                for (const grant of response.result) {
                    logger.info(
                        'Processing grant: projectId=%s, projectName=%s, roleKeys=%s',
                        grant.projectId,
                        grant.projectName,
                        JSON.stringify(grant.roleKeys)
                    );
                    // Check for Fleet Manager project roles
                    for (const roleKey of grant.roleKeys || []) {
                        const normalizedRole = roleKey.toLowerCase();
                        logger.info(
                            'Checking role key: "%s" (normalized: "%s")',
                            roleKey,
                            normalizedRole
                        );
                        if (normalizedRole === FLEET_ROLES.ADMIN) {
                            roles.push(FLEET_ROLES.ADMIN);
                            logger.info('Matched admin role');
                        } else if (normalizedRole === FLEET_ROLES.INSTALLER) {
                            roles.push(FLEET_ROLES.INSTALLER);
                            logger.info('Matched installer role');
                        } else if (normalizedRole === FLEET_ROLES.VIEWER) {
                            roles.push(FLEET_ROLES.VIEWER);
                            logger.info('Matched viewer role');
                        } else {
                            logger.info(
                                'Role "%s" did not match admin, installer or viewer',
                                normalizedRole
                            );
                        }
                    }
                }
            } else {
                logger.warn('No user grants found for user %s', userId);
            }

            // Remove duplicates
            const uniqueRoles = [...new Set(roles)];

            // Determine primary role (admin takes precedence, default to NONE)
            let primaryRole: FleetRole = FLEET_ROLES.NONE;
            if (uniqueRoles.includes(FLEET_ROLES.ADMIN)) {
                primaryRole = FLEET_ROLES.ADMIN;
            } else if (uniqueRoles.includes(FLEET_ROLES.INSTALLER)) {
                primaryRole = FLEET_ROLES.INSTALLER;
            } else if (uniqueRoles.includes(FLEET_ROLES.VIEWER)) {
                primaryRole = FLEET_ROLES.VIEWER;
            } else if (uniqueRoles.length > 0) {
                primaryRole = uniqueRoles[0];
            }

            logger.info(
                'User %s final roles: %s (primary: %s)',
                userId,
                uniqueRoles.join(', ') || 'none',
                primaryRole
            );

            return {
                roles:
                    uniqueRoles.length > 0 ? uniqueRoles : [FLEET_ROLES.NONE],
                primaryRole
            };
        } catch (error) {
            logger.error('Failed to get user roles for %s: %s', userId, error);
            return defaultRoles;
        }
    }

    /**
     * Map a Zitadel role to Fleet Manager permissions and group
     */
    mapRoleToPermissions(role: FleetRole): {
        permissions: string[];
        group: string;
    } {
        switch (role) {
            case FLEET_ROLES.ADMIN:
                return {
                    permissions: ['*'],
                    group: 'admin'
                };
            case FLEET_ROLES.INSTALLER:
                return {
                    permissions: ['read:*', 'waitingroom:*'],
                    group: 'installer'
                };
            case FLEET_ROLES.VIEWER:
                return {
                    permissions: ['read:*'],
                    group: 'viewer'
                };
            default:
                return {
                    permissions: [],
                    group: ''
                };
        }
    }

    /**
     * Set user metadata
     */
    async setUserMetadata(
        userId: string,
        metadata: Partial<FleetUserMetadata>
    ): Promise<void> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        const updates: Array<{key: string; value: string}> = [];

        if (metadata.permissions !== undefined) {
            updates.push({
                key: METADATA_KEYS.PERMISSIONS,
                value: Buffer.from(
                    JSON.stringify(metadata.permissions)
                ).toString('base64')
            });
        }

        if (metadata.group !== undefined) {
            updates.push({
                key: METADATA_KEYS.GROUP,
                value: Buffer.from(metadata.group).toString('base64')
            });
        }

        // Zitadel bulk set metadata
        await this.request(
            'POST',
            `/management/v1/users/${userId}/metadata/_bulk`,
            {
                metadata: updates
            }
        );

        logger.info('Updated metadata for user %s', userId);
    }

    /**
     * List all users in the organization
     */
    async listUsers(): Promise<ZitadelUser[]> {
        if (!this.isConfigured()) {
            return [];
        }

        try {
            const response = await this.request<{
                result?: Array<{
                    userId: string;
                    userName: string;
                    state?: string;
                    human?: {
                        email?: {email: string};
                        profile?: {displayName: string};
                    };
                    machine?: {
                        name: string;
                    };
                }>;
            }>('POST', '/management/v1/users/_search', {
                query: {
                    limit: 1000
                },
                queries: [{typeQuery: {type: 'TYPE_HUMAN'}}]
            });

            return (response.result || []).map((u) => ({
                userId: u.userId,
                userName: u.userName,
                email: u.human?.email?.email,
                displayName:
                    u.human?.profile?.displayName ||
                    u.machine?.name ||
                    u.userName,
                state: u.state
            }));
        } catch (error) {
            logger.error('Failed to list users: %s', error);
            return [];
        }
    }

    /**
     * Find user by email
     */
    async findUserByEmail(email: string): Promise<ZitadelUser | null> {
        if (!this.isConfigured()) {
            return null;
        }

        try {
            const response = await this.request<{
                result?: Array<{
                    userId: string;
                    userName: string;
                    human?: {
                        email?: {email: string};
                        profile?: {displayName: string};
                    };
                }>;
            }>('POST', '/management/v1/users/_search', {
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
                const u = response.result[0];
                return {
                    userId: u.userId,
                    userName: u.userName,
                    email: u.human?.email?.email,
                    displayName: u.human?.profile?.displayName
                };
            }

            return null;
        } catch (error) {
            logger.error('Failed to find user by email %s: %s', email, error);
            return null;
        }
    }

    /**
     * Find user by username
     */
    async findUserByUsername(username: string): Promise<ZitadelUser | null> {
        if (!this.isConfigured()) {
            return null;
        }

        try {
            const response = await this.request<{
                result?: Array<{
                    userId: string;
                    userName: string;
                    human?: {
                        email?: {email: string};
                        profile?: {displayName: string};
                    };
                }>;
            }>('POST', '/management/v1/users/_search', {
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
                const u = response.result[0];
                return {
                    userId: u.userId,
                    userName: u.userName,
                    email: u.human?.email?.email,
                    displayName: u.human?.profile?.displayName
                };
            }

            return null;
        } catch (error) {
            logger.error(
                'Failed to find user by username %s: %s',
                username,
                error
            );
            return null;
        }
    }

    /**
     * Create a human user in Zitadel
     */
    async createHumanUser(params: {
        email: string;
        userName: string;
        firstName: string;
        lastName: string;
        displayName?: string;
        password?: string;
        passwordChangeRequired?: boolean;
    }): Promise<{userId: string}> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        const body: Record<string, any> = {
            userName: params.userName,
            profile: {
                firstName: params.firstName,
                lastName: params.lastName,
                displayName:
                    params.displayName ||
                    `${params.firstName} ${params.lastName}`
            },
            email: {
                email: params.email,
                isEmailVerified: false
            },
            requestPasswordlessRegistration: false
        };

        if (params.password) {
            body.password = params.password;
            body.passwordChangeRequired = params.passwordChangeRequired ?? true;
        }

        const response = await this.request<{userId: string}>(
            'POST',
            '/management/v1/users/human/_import',
            body
        );

        logger.info(
            'Created human user %s with ID %s',
            params.userName,
            response.userId
        );
        return response;
    }

    /**
     * Create a machine user (service account) in Zitadel
     */
    async createMachineUser(
        params: CreateMachineUserParams
    ): Promise<CreateMachineUserResult> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        const response = await this.request<{userId: string}>(
            'POST',
            '/management/v1/users/machine',
            {
                userName: params.userName,
                name: params.name,
                description: params.description || '',
                accessTokenType: 'ACCESS_TOKEN_TYPE_BEARER'
            }
        );

        logger.info(
            'Created machine user %s with ID %s',
            params.userName,
            response.userId
        );

        return {
            userId: response.userId,
            userName: params.userName
        };
    }

    /**
     * Create a Personal Access Token for a machine user
     */
    async createPersonalAccessToken(
        userId: string,
        expirationDate?: Date
    ): Promise<PersonalAccessToken> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        const body: {expirationDate?: string} = {};
        if (expirationDate) {
            body.expirationDate = expirationDate.toISOString();
        }

        const response = await this.request<{
            tokenId: string;
            token: string;
        }>('POST', `/management/v1/users/${userId}/pats`, body);

        logger.info('Created PAT for user %s', userId);

        return {
            tokenId: response.tokenId,
            token: response.token,
            expirationDate: expirationDate?.toISOString()
        };
    }

    /**
     * Send password reset email to user
     */
    async sendPasswordResetEmail(userId: string): Promise<void> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        await this.request(
            'POST',
            `/management/v1/users/${userId}/password/_reset`,
            {
                sendLink: {
                    notificationType: 'NOTIFICATION_TYPE_Email'
                }
            }
        );

        logger.info('Sent password reset email to user %s', userId);
    }

    /**
     * Set fm_permissions metadata for a user (CRUD format).
     * This writes the new permission config directly to Zitadel user metadata.
     */
    async setFmPermissions(
        userId: string,
        config: Record<string, unknown>
    ): Promise<void> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        const encoded = Buffer.from(JSON.stringify(config)).toString('base64');

        await this.request(
            'PUT',
            `/management/v1/users/${userId}/metadata/${FM_PERMISSIONS_KEY}`,
            {value: encoded}
        );

        logger.info('Set fm_permissions for user %s', userId);
    }

    /**
     * Deactivate a user in Zitadel (prevents login)
     */
    async deactivateUser(userId: string): Promise<void> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        await this.request(
            'POST',
            `/management/v1/users/${userId}/deactivate`,
            {}
        );

        logger.info('Deactivated user %s', userId);
    }

    /**
     * Reactivate a previously deactivated user in Zitadel
     */
    async reactivateUser(userId: string): Promise<void> {
        if (!this.isConfigured()) {
            throw new Error('Zitadel not configured');
        }

        await this.request(
            'POST',
            `/management/v1/users/${userId}/reactivate`,
            {}
        );

        logger.info('Reactivated user %s', userId);
    }

    /**
     * Check if Zitadel is configured and available
     */
    isAvailable(): boolean {
        return this.isConfigured();
    }

    /**
     * Check if the Management API is available (requires a service token/PAT).
     * Without this, metadata lookups (getFmPermissions) will be skipped.
     */
    isManagementApiAvailable(): boolean {
        return this.isConfigured() && this.serviceToken !== null;
    }
}

// Singleton instance
export const zitadelService = new ZitadelService();
