// Attach a persona to an existing user, under the Assignment.Create guards.

import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ASSIGNMENT_CREATE_PARAMS_SCHEMA,
    type AssignmentCreateParams,
    type AssignmentResponse,
    type AssignmentScope
} from '../../types/api/assignment';
import type {AssignmentGrantRequest} from '../authz/admin/grantTypes';
import type {assertScopeRefsBelongToOrg} from '../authz/resources';
import {isExplicitScope, SCOPE_NOT_EXPLICIT_MESSAGE} from '../authz/scopeGuard';
import type {ensureZitadelManagement} from './validation';

export interface AttachPersonaParams {
    userId: string;
    personaId: string;
    scope: AssignmentScope;
    reason?: string | null;
    comment?: string | null;
    expiresAt?: string | null;
}

// Injected so a test can make each guard fail without Zitadel or a database.
export interface AttachPersonaDeps {
    ensureZitadelManagement: typeof ensureZitadelManagement;
    assertTargetInTenant: (
        sender: CommandSender,
        targetUserId: string,
        orgId: string
    ) => Promise<void>;
    assertScopeRefsBelongToOrg: typeof assertScopeRefsBelongToOrg;
    createAssignmentGrant: (
        request: AssignmentGrantRequest
    ) => Promise<AssignmentResponse>;
}

export async function attachPersonaToUser(
    rawParams: AttachPersonaParams,
    sender: CommandSender,
    deps: AttachPersonaDeps
) {
    const candidate = {
        subjectType: 'user' as const,
        subjectId: rawParams?.userId,
        personaId: rawParams?.personaId,
        scope: rawParams?.scope,
        reason: rawParams?.reason,
        comment: rawParams?.comment,
        expiresAt: rawParams?.expiresAt
    };
    const p = validateOrThrow<AssignmentCreateParams>(
        candidate,
        ASSIGNMENT_CREATE_PARAMS_SCHEMA
    );
    if (!isExplicitScope(p.scope)) {
        throw RpcError.InvalidParams(SCOPE_NOT_EXPLICIT_MESSAGE);
    }
    const tenantId = sender.getOrganizationId();
    if (!tenantId) throw RpcError.InvalidParams('tenant context missing');
    // Closes the DEV-mode path where userBelongsToTenant returns true always.
    deps.ensureZitadelManagement();
    await deps.assertTargetInTenant(sender, p.subjectId, tenantId);
    await deps.assertScopeRefsBelongToOrg({orgId: tenantId, scope: p.scope});
    const actorId = sender.getUser()?.username ?? 'unknown';
    // createAssignmentGrant refuses a scope the persona does not allow.
    const assignment = await deps.createAssignmentGrant({
        tenantId,
        actorId,
        grantor: sender,
        subjectType: 'user',
        subjectId: p.subjectId,
        personaId: p.personaId,
        scope: p.scope,
        metadata: {
            reason: p.reason,
            comment: p.comment,
            expiresAt: p.expiresAt
        }
    });
    return {success: true, assignmentId: assignment.id};
}
