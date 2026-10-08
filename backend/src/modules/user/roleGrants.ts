// Initial identity-provider role grant for newly created users.
//
// The Fleet Manager project runs with a role check enabled, so a user holding
// no grant on it authenticates and is then refused at token issue — the login
// UI renders that refusal as a generic "unknown error". A user created without
// a grant can therefore never sign in, which is why the persona is required at
// the API rather than defaulted per caller.
//
// The persona becomes the assignment; the role here is only the sign-in gate.

import {getLogger} from 'log4js';
import RpcError from '../../rpc/RpcError';
import {isResourceNotFound, type RpcCallError} from '../../types/api/errors';
import {type AttachablePersona, loadAttachablePersona} from '../authz/admin';
import {identityRoleManager} from '../identity';
import {zitadelService} from '../zitadel';

const logger = getLogger('user-crud');

// Sign-in floor for users whose persona is not a built-in role. Read-only on
// purpose: the persona grants the real permissions, this only opens the door.
export const SIGN_IN_BASELINE_ROLE = 'viewer';

export interface ResolvedPersonaRole {
    role: string;
    // Handed back so downstream checks reuse the row instead of re-reading it.
    persona: AttachablePersona;
}

// The whole mapping, kept free of IO so it can be asserted directly: a
// built-in persona IS a role, a tenant persona is FM permissions that still
// need a role underneath them to reach the app at all.
export function personaSignInRole(persona: AttachablePersona): string {
    return persona.is_system_managed ? persona.key : SIGN_IN_BASELINE_ROLE;
}

export function requirePersonaId(personaId: unknown): string {
    if (typeof personaId !== 'string' || personaId.trim() === '') {
        throw RpcError.InvalidParams('personaId is required');
    }
    return personaId;
}

// Resolves the persona a user is being created with into the identity-provider
// role to grant. Runs before the user is created so an unknown persona fails
// the call outright instead of leaving an unusable account behind.
export async function resolvePersonaRole(
    personaId: unknown,
    tenantId: string
): Promise<ResolvedPersonaRole> {
    const persona = await loadAttachablePersona(
        requirePersonaId(personaId),
        tenantId
    );
    return {
        role: personaSignInRole(persona),
        persona
    };
}

export async function grantInitialRole(
    userId: string,
    role: string,
    organizationId?: string
): Promise<void> {
    try {
        await identityRoleManager.grantSystemRoles({
            userId,
            roleKeys: [role],
            organizationId
        });
    } catch (err) {
        throw RpcError.OperationFailed(
            `grant role "${role}" to user ${userId}`,
            err
        );
    }
}

// On failure, deletes the just-created identity (all-or-nothing) and rethrows
// the original error; a failed rollback is logged, not swallowed. Both create
// paths provision an identity first, so both need the same undo.
export async function withIdentityRollback<T>(
    userId: string,
    operation: string,
    finalize: () => Promise<T>
): Promise<T> {
    try {
        return await finalize();
    } catch (err) {
        await rollbackIdentity(userId, operation, err);
        throw err;
    }
}

async function rollbackIdentity(
    userId: string,
    operation: string,
    cause: unknown
): Promise<void> {
    try {
        await zitadelService.deleteUser(userId);
    } catch (cleanupErr) {
        if (isResourceNotFound(cleanupErr as RpcCallError)) return;
        logger.error(
            '%s rollback failed for %s after %s; manual cleanup required: %s',
            operation,
            userId,
            cause instanceof Error ? cause.message : String(cause),
            cleanupErr
        );
    }
}
