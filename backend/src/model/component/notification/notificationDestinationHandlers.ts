// Notification destination groups + their member references.

import {
    authzAuditActor,
    authzAuditWriter
} from '../../../modules/authz/audit/AuthzAuditWriter';
import * as PostgresProvider from '../../../modules/PostgresProvider';
import {translatePgError} from '../../../rpc/dbErrors';
import {buildListResponse} from '../../../rpc/listResponse';
import {toIso} from '../../../rpc/pgRows';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import {
    DESTINATION_ADD_MEMBERS_PARAMS_SCHEMA,
    DESTINATION_CREATE_PARAMS_SCHEMA,
    DESTINATION_DELETE_PARAMS_SCHEMA,
    DESTINATION_GET_MODEL_PARAMS_SCHEMA,
    DESTINATION_GET_PARAMS_SCHEMA,
    DESTINATION_LIST_MEMBERS_PARAMS_SCHEMA,
    DESTINATION_LIST_PARAMS_SCHEMA,
    DESTINATION_MEMBER_TYPES,
    DESTINATION_REMOVE_MEMBERS_PARAMS_SCHEMA,
    DESTINATION_UPDATE_PARAMS_SCHEMA,
    type DestinationGroup,
    type DestinationMemberRef,
    type DestinationMemberType,
    type DestinationModel
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';

interface DestinationRow {
    id: number;
    organization_id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    created_at: Date | string;
    updated_at: Date | string | null;
    c_members: number | string | null;
    c_rules_referencing: number | string | null;
}
type DestinationListRow = Partial<DestinationRow> & {
    total_count?: number | string;
};

interface MemberRefRow {
    member_type: DestinationMemberType;
    member_id: string;
}
type MemberListRow = Partial<MemberRefRow> & {total_count?: number | string};

function rowToDestinationGroup(row: DestinationRow): DestinationGroup {
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at),
        counts: {
            members: Number(row.c_members ?? 0),
            rulesReferencing: Number(row.c_rules_referencing ?? 0)
        }
    };
}

function rowToMemberRef(row: MemberRefRow): DestinationMemberRef {
    return {memberType: row.member_type, memberId: row.member_id};
}

type DestinationOp =
    | 'create'
    | 'update'
    | 'delete'
    | 'addMembers'
    | 'removeMembers';

/** Map PG constraint violations to domain-error kinds the UI can branch on. */
function translateDestinationError(err: unknown, op: DestinationOp): RpcError {
    return translatePgError(err, `destination ${op}`, {
        unique: 'DestinationNameConflict',
        foreignKey:
            op === 'delete' ? 'DestinationInUseByRule' : 'DestinationNotFound'
    });
}

/**
 * Static capability descriptor returned by Destination.GetModel. Spec §7.6
 * phase-1 lock: no nested groups, no teams, no escalation levels.
 */
const DESTINATION_MODEL_SNAPSHOT: DestinationModel = Object.freeze({
    version: 1,
    memberTypes: [...DESTINATION_MEMBER_TYPES],
    capabilities: Object.freeze({
        nestedGroups: false,
        teamMembers: false,
        escalationLevels: false
    })
}) as DestinationModel;

export function destinationGetModel(params: unknown): DestinationModel {
    validateOrThrow<Record<string, never>>(
        params ?? {},
        DESTINATION_GET_MODEL_PARAMS_SCHEMA
    );
    return DESTINATION_MODEL_SNAPSHOT;
}

export async function destinationList(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        enabled?: boolean;
        query?: string;
        limit?: number;
        offset?: number;
    }>(params, DESTINATION_LIST_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const limit = p.limit ?? 200;
    const offset = p.offset ?? 0;

    const result = await PostgresProvider.callMethod(
        'notifications.fn_destination_list',
        {
            p_organization_id: orgId,
            p_enabled: p.enabled ?? null,
            p_query: p.query?.trim() || null,
            p_limit: limit,
            p_offset: offset
        }
    );
    const rows = (result?.rows ?? []) as DestinationListRow[];
    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const items: DestinationGroup[] = [];
    for (const row of rows) {
        if (row.id == null) continue;
        items.push(rowToDestinationGroup(row as DestinationRow));
    }
    return buildListResponse(items, total, limit, offset);
}

export async function destinationGet(
    params: unknown,
    sender: CommandSender
): Promise<DestinationGroup> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        DESTINATION_GET_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);

    const result = await PostgresProvider.callMethod(
        'notifications.fn_destination_get',
        {p_organization_id: orgId, p_id: p.id}
    );
    const row = result?.rows?.[0] as DestinationRow | undefined;
    if (!row)
        throw RpcError.Domain('DestinationNotFound', {
            details: {id: p.id}
        });
    return rowToDestinationGroup(row);
}

export async function destinationCreate(
    params: unknown,
    sender: CommandSender
): Promise<DestinationGroup> {
    const p = validateOrThrow<{
        organizationId?: string;
        name: string;
        description?: string | null;
        enabled?: boolean;
    }>(params, DESTINATION_CREATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_destination_create',
            {
                p_organization_id: orgId,
                p_name: p.name.trim(),
                p_description: p.description ?? null,
                p_enabled: p.enabled ?? true
            }
        );
        const row = result?.rows?.[0] as DestinationRow | undefined;
        if (!row) throw RpcError.OperationFailed('destination create');
        await authzAuditWriter.writeNotificationDestinationEvent({
            tenantId: orgId,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'create',
            destinationId: row.id,
            name: row.name ?? p.name
        });
        return rowToDestinationGroup(row);
    } catch (err: unknown) {
        throw translateDestinationError(err, 'create');
    }
}

export async function destinationUpdate(
    params: unknown,
    sender: CommandSender
): Promise<DestinationGroup> {
    const p = validateOrThrow<{
        organizationId?: string;
        id: number;
        patch: {
            name?: string;
            description?: string | null;
            enabled?: boolean;
        };
    }>(params, DESTINATION_UPDATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const patch = p.patch ?? {};
    const clearDescription = patch.description === null;

    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_destination_update',
            {
                p_organization_id: orgId,
                p_id: p.id,
                p_name: patch.name?.trim() ?? null,
                p_description: clearDescription
                    ? null
                    : (patch.description ?? null),
                p_clear_description: clearDescription,
                p_enabled: patch.enabled ?? null
            }
        );
        const row = result?.rows?.[0] as DestinationRow | undefined;
        if (!row)
            throw RpcError.Domain('DestinationNotFound', {
                details: {id: p.id}
            });
        await authzAuditWriter.writeNotificationDestinationEvent({
            tenantId: orgId,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'update',
            destinationId: row.id,
            name: row.name ?? undefined
        });
        return rowToDestinationGroup(row);
    } catch (err: unknown) {
        if (err instanceof RpcError) throw err;
        throw translateDestinationError(err, 'update');
    }
}

export async function destinationDelete(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        DESTINATION_DELETE_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);

    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_destination_delete',
            {p_organization_id: orgId, p_id: p.id}
        );
        const row = result?.rows?.[0] as {id?: number} | undefined;
        if (row?.id) {
            await authzAuditWriter.writeNotificationDestinationEvent({
                tenantId: orgId,
                actorId: authzAuditActor(sender.getUser?.()),
                operation: 'delete',
                destinationId: p.id
            });
        }
        return {deleted: !!row?.id, id: p.id};
    } catch (err: unknown) {
        throw translateDestinationError(err, 'delete');
    }
}

export async function destinationListMembers(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        id: number;
        limit?: number;
        offset?: number;
    }>(params, DESTINATION_LIST_MEMBERS_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const limit = p.limit ?? 200;
    const offset = p.offset ?? 0;

    const result = await PostgresProvider.callMethod(
        'notifications.fn_destination_list_members',
        {
            p_organization_id: orgId,
            p_id: p.id,
            p_limit: limit,
            p_offset: offset
        }
    );
    const rows = (result?.rows ?? []) as MemberListRow[];
    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const items: DestinationMemberRef[] = [];
    for (const row of rows) {
        if (!row.member_type || !row.member_id) continue;
        items.push(rowToMemberRef(row as MemberRefRow));
    }
    return buildListResponse(items, total, limit, offset);
}

export async function destinationAddMembers(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        id: number;
        members: DestinationMemberRef[];
    }>(params, DESTINATION_ADD_MEMBERS_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_destination_add_members_batch',
            {
                p_organization_id: orgId,
                p_id: p.id,
                p_members: JSON.stringify(
                    p.members.map((m) => ({
                        member_type: m.memberType,
                        member_id: m.memberId
                    }))
                )
            }
        );
        const rows = (result?.rows ?? []) as MemberRefRow[];
        await authzAuditWriter.writeNotificationDestinationEvent({
            tenantId: orgId,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'add_members',
            destinationId: p.id,
            added: rows.length
        });
        return {id: p.id, added: rows.map(rowToMemberRef)};
    } catch (err: unknown) {
        throw translateDestinationError(err, 'addMembers');
    }
}

export async function destinationRemoveMembers(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        id: number;
        members: DestinationMemberRef[];
    }>(params, DESTINATION_REMOVE_MEMBERS_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_destination_remove_members_batch',
            {
                p_organization_id: orgId,
                p_id: p.id,
                p_members: JSON.stringify(
                    p.members.map((m) => ({
                        member_type: m.memberType,
                        member_id: m.memberId
                    }))
                )
            }
        );
        const rows = (result?.rows ?? []) as MemberRefRow[];
        await authzAuditWriter.writeNotificationDestinationEvent({
            tenantId: orgId,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'remove_members',
            destinationId: p.id,
            removed: rows.length
        });
        return {id: p.id, removed: rows.map(rowToMemberRef)};
    } catch (err: unknown) {
        throw translateDestinationError(err, 'removeMembers');
    }
}
