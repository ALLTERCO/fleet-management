import {authzAuditWriter} from '../../modules/authz/audit';
import {loadAuthzConfig} from '../../modules/authz/config';
import {identityDirectory} from '../../modules/identity';
import * as store from '../../modules/PostgresProvider';
import {ensureZitadelManagement} from '../../modules/user/validation';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    USER_GROUP_ADD_MEMBERS_PARAMS_SCHEMA,
    USER_GROUP_CREATE_PARAMS_SCHEMA,
    USER_GROUP_DELETE_PARAMS_SCHEMA,
    USER_GROUP_DESCRIBE,
    USER_GROUP_GET_PARAMS_SCHEMA,
    USER_GROUP_LIST_MEMBERS_PARAMS_SCHEMA,
    USER_GROUP_LIST_PARAMS_SCHEMA,
    USER_GROUP_REMOVE_MEMBERS_PARAMS_SCHEMA,
    USER_GROUP_UPDATE_PARAMS_SCHEMA,
    type UserGroupAddMembersParams,
    type UserGroupCreateParams,
    type UserGroupDeleteParams,
    type UserGroupGetParams,
    type UserGroupListMembersParams,
    type UserGroupListParams,
    type UserGroupRemoveMembersParams,
    type UserGroupResponse,
    type UserGroupUpdateParams
} from '../../types/api/user_group';
import type CommandSender from '../CommandSender';
import {canManageAuthz, canReadPolicies} from './authzPermissions';
import Component from './Component';

interface Config {
    enable: boolean;
}

async function callGroupRows(
    fn: string,
    params: Record<string, unknown>
): Promise<UserGroupResponse[]> {
    const result = await store.callMethod(fn, params);
    return (result?.rows ?? []) as UserGroupResponse[];
}

async function assertGroupExists(
    groupId: string,
    tenantId: string
): Promise<void> {
    const result = await store.callMethod('organization.fn_user_group_exists', {
        p_id: groupId,
        p_tenant_id: tenantId
    });
    const exists =
        (result?.rows?.[0] as {fn_user_group_exists?: boolean} | undefined)
            ?.fn_user_group_exists === true;
    if (!exists) throw RpcError.NotFound('user_group');
}

// FM-owned user-grouping for permission inheritance. Distinct from the existing
// device-group component (model/component/GroupComponent.ts) which groups
// devices for organizational purposes.
export default class UserGroupComponent extends Component<Config> {
    constructor() {
        super('user_group', {viewer_visible: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return USER_GROUP_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CheckPermissions(canReadPolicies)
    async list(params: unknown, sender: CommandSender) {
        validateOrThrow<UserGroupListParams>(
            params,
            USER_GROUP_LIST_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const rows = await callGroupRows('organization.fn_user_group_list', {
            p_tenant_id: orgId
        });
        return buildListResponse(rows, rows.length, rows.length, 0);
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CheckPermissions(canReadPolicies)
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<UserGroupGetParams>(
            params,
            USER_GROUP_GET_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const rows = await callGroupRows('organization.fn_user_group_get', {
            p_id: p.id,
            p_tenant_id: orgId
        });
        if (rows.length === 0) throw RpcError.NotFound('user_group');
        return rows[0];
    }

    @Component.Expose('Create')
    @Component.CheckPermissions(canManageAuthz)
    async create(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<UserGroupCreateParams>(
            params,
            USER_GROUP_CREATE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        if (p.parentGroupId) {
            await this.assertParentInTenant(p.parentGroupId, orgId);
        }
        const rows = await callGroupRows('organization.fn_user_group_create', {
            p_tenant_id: orgId,
            p_name: p.name,
            p_description: p.description ?? null,
            p_parent_group_id: p.parentGroupId ?? null
        });
        await authzAuditWriter.writeUserGroupEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'create',
            userGroupId: rows[0].id,
            name: p.name,
            parentGroupId: p.parentGroupId ?? null
        });
        return {...rows[0], member_count: 0};
    }

    @Component.Expose('Update')
    @Component.CheckPermissions(canManageAuthz)
    async update(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<UserGroupUpdateParams>(
            params,
            USER_GROUP_UPDATE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const reparenting = Object.hasOwn(p, 'parentGroupId');
        if (reparenting && p.parentGroupId) {
            if (p.parentGroupId === p.id) {
                throw RpcError.InvalidParams(
                    'parentGroupId cannot be the group itself'
                );
            }
            await this.assertParentInTenant(p.parentGroupId, orgId);
            await this.assertNoCycle(p.id, p.parentGroupId, orgId);
        }
        const clearDescription =
            Object.hasOwn(p, 'description') && p.description === null;
        const rows = await callGroupRows('organization.fn_user_group_update', {
            p_id: p.id,
            p_tenant_id: orgId,
            p_name: p.name ?? null,
            p_description: clearDescription ? null : (p.description ?? null),
            p_parent_group_id: p.parentGroupId ?? null,
            p_reparent: reparenting,
            p_clear_description: clearDescription
        });
        if (rows.length === 0) throw RpcError.NotFound('user_group');
        await authzAuditWriter.writeUserGroupEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'update',
            userGroupId: rows[0].id,
            name: p.name,
            description: p.description,
            parentGroupId: reparenting ? (p.parentGroupId ?? null) : undefined
        });
        return rows[0];
    }

    private async assertParentInTenant(
        parentId: string,
        tenantId: string
    ): Promise<void> {
        try {
            await assertGroupExists(parentId, tenantId);
        } catch (err) {
            if (err instanceof RpcError) {
                throw RpcError.NotFound('parent user_group');
            }
            throw err;
        }
    }

    // Reject moves where new parent is a descendant. Bounded by FM_AUTHZ_GROUP_DEPTH_MAX.
    private async assertNoCycle(
        groupId: string,
        newParentId: string,
        tenantId: string
    ): Promise<void> {
        const depthMax = loadAuthzConfig().groupDepthMax;
        const result = await store.callMethod(
            'organization.fn_user_group_is_descendant',
            {
                p_group_id: groupId,
                p_tenant_id: tenantId,
                p_new_parent_id: newParentId,
                p_depth_max: depthMax
            }
        );
        const isDescendant =
            (
                result?.rows?.[0] as
                    | {fn_user_group_is_descendant?: boolean}
                    | undefined
            )?.fn_user_group_is_descendant === true;
        if (isDescendant) {
            throw RpcError.InvalidParams(
                'parentGroupId would create a cycle (new parent is a descendant)'
            );
        }
    }

    @Component.Expose('Delete')
    @Component.CheckPermissions(canManageAuthz)
    async delete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<UserGroupDeleteParams>(
            params,
            USER_GROUP_DELETE_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const result = await store.callMethod(
            'organization.fn_user_group_delete_safe',
            {p_id: p.id, p_tenant_id: orgId}
        );
        const summary = (result?.rows?.[0] as
            | {ref_count: number; deleted_count: number}
            | undefined) ?? {ref_count: 0, deleted_count: 0};
        if (summary.ref_count > 0) {
            throw RpcError.InvalidParams(
                `user_group has ${summary.ref_count} assignment(s); detach them first`
            );
        }
        if (summary.deleted_count === 0) {
            throw RpcError.NotFound('user_group');
        }
        await authzAuditWriter.writeUserGroupEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'delete',
            userGroupId: p.id
        });
        return {success: true};
    }

    @Component.NoAudit
    @Component.Expose('ListMembers')
    @Component.CheckPermissions(canReadPolicies)
    async listMembers(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<UserGroupListMembersParams>(
            params,
            USER_GROUP_LIST_MEMBERS_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        await assertGroupExists(p.id, orgId);
        const result = await store.callMethod(
            'organization.fn_user_group_list_members',
            {p_group_id: p.id}
        );
        const rows = (result?.rows ?? []) as Array<{
            user_id: string;
            added_at: string;
            added_by: string;
        }>;
        return buildListResponse(rows, rows.length, rows.length, 0);
    }

    @Component.Expose('AddMembers')
    @Component.CheckPermissions(canManageAuthz)
    async addMembers(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<UserGroupAddMembersParams>(
            params,
            USER_GROUP_ADD_MEMBERS_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();
        await assertGroupExists(p.id, orgId);
        const requested = Array.from(new Set(p.userIds));
        // ensureZitadelManagement before the per-uid Zitadel check so the
        // DEV/misconfigured fail-open path (userBelongsToTenant returns
        // true unconditionally when !isConfigured) can't be used to add
        // arbitrary foreign userIds.
        ensureZitadelManagement();
        // Each user must belong to this tenant on the Zitadel side.
        // Without this, a tenant admin can add a foreign Zitadel userId
        // to a local group; group membership then satisfies
        // userHasPresenceInTenant downstream, faking tenant presence
        // for PAT creation and persona assignment.
        for (const uid of requested) {
            const belongs = await identityDirectory.userBelongsToTenant({
                userId: uid,
                tenantId: orgId
            });
            if (!belongs) {
                throw RpcError.NotFound(
                    `user ${uid} is not a member of this tenant`
                );
            }
        }
        const result = await store.callMethod(
            'organization.fn_user_group_add_members',
            {p_group_id: p.id, p_user_ids: requested, p_added_by: actorId}
        );
        const rows = (result?.rows ?? []) as Array<{user_id: string}>;
        const added = rows.map((r) => r.user_id);
        const addedSet = new Set(added);
        const alreadyMember = requested.filter((u) => !addedSet.has(u));
        if (added.length > 0) {
            await authzAuditWriter.writeUserGroupEvent({
                tenantId: orgId,
                actorId,
                operation: 'add_members',
                userGroupId: p.id,
                added
            });
        }
        return {added, alreadyMember};
    }

    @Component.Expose('RemoveMembers')
    @Component.CheckPermissions(canManageAuthz)
    async removeMembers(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<UserGroupRemoveMembersParams>(
            params,
            USER_GROUP_REMOVE_MEMBERS_PARAMS_SCHEMA
        );
        const orgId = requireOrganizationId(sender);
        const actorId = sender.getUser()?.username ?? 'unknown';
        await assertGroupExists(p.id, orgId);
        const requested = Array.from(new Set(p.userIds));
        const result = await store.callMethod(
            'organization.fn_user_group_remove_members',
            {p_group_id: p.id, p_user_ids: requested}
        );
        const rows = (result?.rows ?? []) as Array<{user_id: string}>;
        const removed = rows.map((r) => r.user_id);
        const removedSet = new Set(removed);
        const notMember = requested.filter((u) => !removedSet.has(u));
        if (removed.length > 0) {
            await authzAuditWriter.writeUserGroupEvent({
                tenantId: orgId,
                actorId,
                operation: 'remove_members',
                userGroupId: p.id,
                removed
            });
        }
        return {removed, notMember};
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
