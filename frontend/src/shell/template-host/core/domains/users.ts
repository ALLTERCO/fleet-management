// People, machine accounts, and the tokens they hold.
//
// `authenticate`, `authenticatealexa`, `refresh`, `refreshalexa` and
// `rotatetoken` are deliberately not here: the host owns the session, and a
// template that mints its own is a way around it.

import type {HostMethod, HostParams} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type UserMethod = Extract<HostMethod, `user.${string}`>;

export type HostOrganizationUserStatus = 'active' | 'inactive' | 'unknown';

export type HostOrganizationUser = {
    id: string;
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    status: HostOrganizationUserStatus;
    roles: string[];
};

export type HostOrganizationUserDirectory = {
    available: boolean;
    users: HostOrganizationUser[];
};

export type HostOrganizationUserCreateInput = {
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    displayName?: string;
    personaId: string;
    scope?: HostParams<'user.createzitadeluser'>['scope'];
    password?: string;
    passwordChangeRequired?: boolean;
};

export type HostOrganizationUserUpdateInput = {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
};

type RawUser = {
    userId?: unknown;
    userName?: unknown;
    email?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    displayName?: unknown;
    state?: unknown;
    roles?: unknown;
};

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeStatus(value: unknown): HostOrganizationUserStatus {
    const state = typeof value === 'string' ? value.toLowerCase() : '';
    if (
        state.includes('inactive') ||
        state.includes('disabled') ||
        state.includes('locked')
    ) {
        return 'inactive';
    }
    if (state.includes('active')) return 'active';
    return 'unknown';
}

function normalizeRoles(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [
        ...new Set(
            value.flatMap((role) => {
                const normalized = optionalString(role);
                return normalized ? [normalized] : [];
            })
        )
    ];
}

function normalizeUser(value: unknown): HostOrganizationUser | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as RawUser;
    const id = optionalString(raw.userId);
    const username = optionalString(raw.userName);
    if (!id || !username) return null;
    return {
        id,
        username,
        email: optionalString(raw.email),
        firstName: optionalString(raw.firstName),
        lastName: optionalString(raw.lastName),
        displayName: optionalString(raw.displayName),
        status: normalizeStatus(raw.state),
        roles: normalizeRoles(raw.roles)
    };
}

export type FleetUserDomain = ReturnType<typeof createUserDomain>;

export function createUserDomain(access: FleetRpcAccess) {
    const user = namespaceCaller<UserMethod>(access);

    return {
        async directory(): Promise<HostOrganizationUserDirectory> {
            const availability = await access.rpc<{available: boolean}>(
                'user.zitadelavailable',
                {}
            );
            if (!availability.available) return {available: false, users: []};
            const result = await access.rpc<{items?: unknown[]}>(
                'user.listzitadelusers',
                {}
            );
            return {
                available: true,
                users: (result.items ?? [])
                    .map(normalizeUser)
                    .filter(
                        (user): user is HostOrganizationUser => user !== null
                    )
            };
        },
        create(input: HostOrganizationUserCreateInput): Promise<{id: string}> {
            return access
                .rpc<{userId: string}>('user.createzitadeluser', {
                    email: input.email,
                    userName: input.username,
                    firstName: input.firstName,
                    lastName: input.lastName,
                    displayName: input.displayName,
                    personaId: input.personaId,
                    scope: input.scope,
                    password: input.password,
                    passwordChangeRequired: input.passwordChangeRequired
                })
                .then(({userId}) => ({id: userId}));
        },
        update(
            input: HostOrganizationUserUpdateInput
        ): Promise<{success: boolean}> {
            return access.rpc('user.updatezitadeluser', {
                userId: input.id,
                email: input.email,
                firstName: input.firstName,
                lastName: input.lastName,
                displayName: input.displayName
            });
        },
        sendPasswordReset(id: string): Promise<{success: boolean}> {
            return access.rpc('user.sendpasswordreset', {userId: id});
        },
        deactivate(id: string): Promise<{success: boolean}> {
            return access.rpc('user.deactivateuser', {userId: id});
        },
        reactivate(id: string): Promise<{success: boolean}> {
            return access.rpc('user.reactivateuser', {userId: id});
        },
        delete(id: string): Promise<{success: boolean}> {
            return access.rpc('user.deletezitadeluser', {userId: id});
        },
        /** The caller's own profile and the permissions the UI gates on. */
        me: (params: HostParams<'user.getme'> = {}) =>
            user('user.getme', params),
        /** The resolved shape WITH provenance — why a user can do a thing. */
        effectivePermissions: (
            params: HostParams<'user.geteffectivepermissionsv2'>
        ) => user('user.geteffectivepermissionsv2', params),
        /** Answers "would this be allowed" without doing it. */
        simulate: (params: HostParams<'user.simulatev2'>) =>
            user('user.simulatev2', params),
        attachCustomPersona: (params: HostParams<'user.attachcustompersona'>) =>
            user('user.attachcustompersona', params),
        /** Install-wide debug-login switch, not a per-user setting. */
        setAllowDebug: (params: HostParams<'user.setallowdebug'>) =>
            user('user.setallowdebug', params),
        profilePicture: {
            /** The upload itself is an HTTP POST; this only mints the ticket. */
            uploadTicket: (
                params: HostParams<'user.profilepicture.createuploadticket'>
            ) => user('user.profilepicture.createuploadticket', params),
            url: (params: HostParams<'user.profilepicture.geturl'>) =>
                user('user.profilepicture.geturl', params),
            /** Falls back to the default avatar; it does not break `url`. */
            remove: (params: HostParams<'user.profilepicture.remove'>) =>
                user('user.profilepicture.remove', params)
        },
        /** Machine accounts. One created without a persona signs in and can do
         *  nothing, which reads like a broken integration. */
        serviceUsers: {
            list: (params: HostParams<'user.listserviceusers'> = {}) =>
                user('user.listserviceusers', params),
            create: (params: HostParams<'user.createserviceuser'>) =>
                user('user.createserviceuser', params),
            /** Irreversible. Deactivate the human equivalent instead. */
            delete: (params: HostParams<'user.deleteserviceuser'>) =>
                user('user.deleteserviceuser', params)
        },
        /** Zitadel PATs. `create` returns the token once — nothing shows it again. */
        pats: {
            create: (params: HostParams<'user.createpat'>) =>
                user('user.createpat', params),
            list: (params: HostParams<'user.listpats'>) =>
                user('user.listpats', params),
            revoke: (params: HostParams<'user.revokepat'>) =>
                user('user.revokepat', params),
            /** Replaces one Zitadel PAT and returns the new secret once. */
            rotate: (params: HostParams<'user.rotatepat'>) =>
                user('user.rotatepat', params)
        },
        /** FM-issued PATs carrying a boundary that can only subtract access,
         *  never escalate it. Also returned once. */
        scopedPats: {
            create: (params: HostParams<'user.createscopedpat'>) =>
                user('user.createscopedpat', params),
            list: (params: HostParams<'user.listscopedpats'> = {}) =>
                user('user.listscopedpats', params),
            /** Check a boundary before minting: too narrow and the key is dead. */
            preview: (params: HostParams<'user.previewscopedpat'>) =>
                user('user.previewscopedpat', params),
            revoke: (params: HostParams<'user.revokescopedpat'>) =>
                user('user.revokescopedpat', params),
            /** Revoke and mint in one transaction, same boundary. */
            rotate: (params: HostParams<'user.rotatescopedpat'>) =>
                user('user.rotatescopedpat', params),
            /** Off-boarding: every active scoped PAT the user holds. */
            revokeAll: (params: HostParams<'user.revokealluserpats'>) =>
                user('user.revokealluserpats', params)
        }
    };
}
