// Shared Zitadel plumbing: the token-bound HTTP context the facade exposes to
// domain clients, plus pure validation/normalize helpers. Domain clients call
// back through the context so a swapped `request` on the singleton stays visible.

import {getLogger} from 'log4js';
import {zitadelPatDefaultExpirationDays} from '../../config/zitadel';

const logger = getLogger('zitadel');

// ORGANIZATION_ID tags machine users with their FM tenant for listMachineUsers filter.
export const METADATA_KEYS = {
    PERMISSIONS: 'fleet_permissions',
    GROUP: 'fleet_group',
    ORGANIZATION_ID: 'fleet_organization_id'
} as const;

export interface FleetUserMetadata {
    permissions: string[];
    group: string;
    organizationId?: string;
}

export interface ZitadelUser {
    userId: string;
    userName: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    state?: string;
}

export interface ZitadelV2User {
    userId?: string;
    id?: string;
    userName?: string;
    username?: string;
    state?: string;
    human?: {
        email?: {email?: string};
        profile?: {
            firstName?: string;
            lastName?: string;
            givenName?: string;
            familyName?: string;
            displayName?: string;
        };
    };
    machine?: {
        name?: string;
        description?: string;
    };
}

export interface FleetProjectRef {
    projectId: string;
    organizationId: string;
}

// The plumbing surface domain clients depend on. The facade implements it; tests
// swap members on the same instance, so client calls observe the swap.
export interface ZitadelHttpContext {
    baseUrl: string;
    request<T>(
        method: string,
        path: string,
        body?: unknown,
        opts?: {orgId?: string}
    ): Promise<T>;
    isConfigured(): boolean;
    getServiceToken(): Promise<string>;
    getFleetProject(): Promise<FleetProjectRef>;
    normalizeUser(user: ZitadelV2User): ZitadelUser;
}

// Validate an ID (userId, tokenId, etc.) to prevent path traversal.
// Zitadel IDs are numeric strings or alphanumeric with dashes.
export function validateId(id: string, label = 'ID'): string {
    if (!id || typeof id !== 'string') {
        throw new Error(`${label} is required`);
    }
    // Zitadel uses numeric IDs — reject anything with path separators or special chars
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error(`Invalid ${label} format`);
    }
    return id;
}

export function defaultPatExpirationDate(): Date {
    const expirationDate = new Date();
    expirationDate.setDate(
        expirationDate.getDate() + zitadelPatDefaultExpirationDays()
    );
    return expirationDate;
}

export function normalizeUser(user: ZitadelV2User): ZitadelUser {
    const profile = user.human?.profile;
    const userName = user.username || user.userName || '';

    return {
        userId: user.userId || user.id || '',
        userName,
        email: user.human?.email?.email,
        firstName: profile?.givenName || profile?.firstName,
        lastName: profile?.familyName || profile?.lastName,
        displayName: profile?.displayName || user.machine?.name || userName,
        state: user.state
    };
}

export {logger as zitadelLogger};
