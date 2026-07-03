import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import type {
    AssignmentGrantMetadata,
    AssignmentScope
} from '../../types/api/assignment';
import {
    type AssignmentGrantRequest,
    assertAssignmentGrantAllowed,
    createAssignmentGrant
} from '../authz/admin';
import {authzAuditWriter, type UserGroupAuditInput} from '../authz/audit';
import * as store from '../PostgresProvider';

export interface ServiceUserAssignmentInput {
    personaId: string;
    scope: AssignmentScope;
    metadata?: AssignmentGrantMetadata;
}

export interface ServiceUserAccessRequest {
    tenantId: string;
    actorId: string;
    userId: string;
    groupIds: string[];
    assignments: ServiceUserAssignmentInput[];
    sender: CommandSender;
}

export interface ServiceUserAccessPreview {
    groups: string[];
    directAssignments: Array<{
        id: string;
        personaId: string;
        scope: AssignmentScope;
    }>;
}

export interface ServiceUserAccessDeps {
    callMethod(
        method: string,
        params: Record<string, unknown>
    ): Promise<{rows?: unknown[]} | undefined>;
    createAssignmentGrant(
        request: AssignmentGrantRequest
    ): Promise<{id: string}>;
    assertAssignmentGrantAllowed(
        request: Parameters<typeof assertAssignmentGrantAllowed>[0]
    ): Promise<void>;
    writeUserGroupEvent(input: UserGroupAuditInput): Promise<void>;
}

const defaultDeps: ServiceUserAccessDeps = {
    callMethod: store.callMethod,
    createAssignmentGrant,
    assertAssignmentGrantAllowed,
    writeUserGroupEvent: (input) => authzAuditWriter.writeUserGroupEvent(input)
};

export function emptyServiceUserAccess(): ServiceUserAccessPreview {
    return {groups: [], directAssignments: []};
}

// Reject everything configureServiceUserAccess would reject, WITHOUT writing.
// Runs before the identity is created so a bad grant or missing group cannot
// leave a half-created user behind.
export async function assertServiceUserAccessAllowed(
    request: Omit<ServiceUserAccessRequest, 'userId' | 'actorId'>,
    deps: ServiceUserAccessDeps = defaultDeps
): Promise<void> {
    for (const groupId of request.groupIds) {
        await assertUserGroupExists(groupId, request.tenantId, deps);
    }
    for (const assignment of request.assignments) {
        await deps.assertAssignmentGrantAllowed({
            tenantId: request.tenantId,
            grantor: request.sender,
            subjectType: 'user',
            subjectIsServiceUser: true,
            personaId: assignment.personaId,
            scope: assignment.scope,
            metadata: assignment.metadata
        });
    }
}

export async function configureServiceUserAccess(
    request: ServiceUserAccessRequest,
    deps: ServiceUserAccessDeps = defaultDeps
): Promise<ServiceUserAccessPreview> {
    const groups = await addServiceUserToGroups(request, deps);
    const directAssignments = await createDirectServiceUserAssignments(
        request,
        deps
    );
    return {groups, directAssignments};
}

async function addServiceUserToGroups(
    request: ServiceUserAccessRequest,
    deps: ServiceUserAccessDeps
): Promise<string[]> {
    const addedGroups: string[] = [];
    for (const groupId of request.groupIds) {
        await assertUserGroupExists(groupId, request.tenantId, deps);
        const result = await deps.callMethod(
            'organization.fn_user_group_add_members',
            {
                p_group_id: groupId,
                p_user_ids: [request.userId],
                p_added_by: request.actorId
            }
        );
        if (!hasAddedMemberRow(result)) continue;
        addedGroups.push(groupId);
        await deps.writeUserGroupEvent({
            tenantId: request.tenantId,
            actorId: request.actorId,
            operation: 'add_members',
            userGroupId: groupId,
            added: [request.userId]
        });
    }
    return addedGroups;
}

async function assertUserGroupExists(
    groupId: string,
    tenantId: string,
    deps: ServiceUserAccessDeps
): Promise<void> {
    const result = await deps.callMethod('organization.fn_user_group_exists', {
        p_id: groupId,
        p_tenant_id: tenantId
    });
    if (!hasUserGroupExistsRow(result)) throw RpcError.NotFound('user_group');
}

function hasUserGroupExistsRow(
    result:
        | {
              rows?: unknown[];
          }
        | undefined
): boolean {
    const row = result?.rows?.[0] as
        | {fn_user_group_exists?: boolean}
        | undefined;
    return row?.fn_user_group_exists === true;
}

function hasAddedMemberRow(result: {rows?: unknown[]} | undefined): boolean {
    return (result?.rows?.length ?? 0) > 0;
}

async function createDirectServiceUserAssignments(
    request: ServiceUserAccessRequest,
    deps: ServiceUserAccessDeps
): Promise<ServiceUserAccessPreview['directAssignments']> {
    const created: ServiceUserAccessPreview['directAssignments'] = [];
    for (const assignment of request.assignments) {
        const row = await deps.createAssignmentGrant({
            tenantId: request.tenantId,
            actorId: request.actorId,
            grantor: request.sender,
            subjectType: 'user',
            subjectId: request.userId,
            subjectIsServiceUser: true,
            personaId: assignment.personaId,
            scope: assignment.scope,
            metadata: assignment.metadata
        });
        created.push({
            id: row.id,
            personaId: assignment.personaId,
            scope: assignment.scope
        });
    }
    return created;
}
