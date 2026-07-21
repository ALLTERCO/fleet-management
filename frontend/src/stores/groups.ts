import type {
    Group as ApiGroup,
    GroupActivityEntry,
    GroupDeviceMembership,
    GroupMemberRef
} from '@api/group';
import {GROUP_MEMBERS_MAX_PER_CALL} from '@api/group';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {deviceMembers} from '@/helpers/groupMembers';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {subjectRefKey} from '@/helpers/subjectRefs';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import {createStaleGuard} from '@/stores/staleGuard';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

// ApiGroup + UI `devices` — populated via group.listDeviceMemberships.
export type StoreGroup = ApiGroup & {
    devices: string[];
    members: GroupMemberRef[];
};

type MembershipMutationMode = 'add' | 'remove';
type ItemsResponse<T> = {items: T[]};

// Match backend schema maxima.
const MAX_GROUPS_PER_PAGE = 1000;
const MAX_IDS_PER_MEMBERSHIPS_CALL = 1000;
const MAX_MEMBERS_PER_PAGE = 1000;

function listGroupsBulk(params: {
    parentGroupId?: number | null;
}): Promise<ApiGroup[]> {
    return paginate<ApiGroup>(
        (offset) =>
            ws.sendRPC<PagedEnvelope<ApiGroup>>('FLEET_MANAGER', 'group.list', {
                ...params,
                limit: MAX_GROUPS_PER_PAGE,
                offset
            }),
        MAX_GROUPS_PER_PAGE
    );
}

async function listMembershipsBulk(
    ids: number[]
): Promise<Record<number, string[]>> {
    const byGroup: Record<number, string[]> = {};
    for (const id of ids) byGroup[id] = [];
    if (ids.length === 0) return byGroup;

    for (let i = 0; i < ids.length; i += MAX_IDS_PER_MEMBERSHIPS_CALL) {
        const chunk = ids.slice(i, i + MAX_IDS_PER_MEMBERSHIPS_CALL);
        const res = await ws.sendRPC<ItemsResponse<GroupDeviceMembership>>(
            'FLEET_MANAGER',
            'group.listdevicememberships',
            {ids: chunk}
        );
        // ??= guards against unexpected groupIds outside the requested chunk.
        for (const m of res?.items ?? []) {
            (byGroup[m.groupId] ??= []).push(m.subjectId);
        }
    }
    return byGroup;
}

async function listAllMembersForGroup(id: number): Promise<GroupMemberRef[]> {
    return paginate<GroupMemberRef>(
        (offset) =>
            ws.sendRPC<PagedEnvelope<GroupMemberRef>>(
                'FLEET_MANAGER',
                'group.listmembers',
                {
                    id,
                    limit: MAX_MEMBERS_PER_PAGE,
                    offset
                }
            ),
        MAX_MEMBERS_PER_PAGE
    );
}

function memberBatches(members: GroupMemberRef[]): GroupMemberRef[][] {
    const batches: GroupMemberRef[][] = [];
    for (let i = 0; i < members.length; i += GROUP_MEMBERS_MAX_PER_CALL) {
        batches.push(members.slice(i, i + GROUP_MEMBERS_MAX_PER_CALL));
    }
    return batches;
}

export const useGroupsStore = defineStore('groups', () => {
    const groups = ref<Record<number, StoreGroup>>({});
    const loading = ref(true);
    const toast = useToastStore();

    // Fetch groups + members, apply in one reactive update.
    // Stale guard + post-await re-read: a concurrent fetchGroup/fetchMembers
    // landing between the awaits and the write would otherwise be clobbered.
    const refreshScopeGuard = createStaleGuard();
    async function refreshScope(
        listParams: {parentGroupId?: number | null},
        affects: (g: StoreGroup) => boolean
    ): Promise<void> {
        const token = refreshScopeGuard.bump();
        const items = await listGroupsBulk(listParams);
        if (refreshScopeGuard.isStale(token)) return;
        const ids = items.map((g) => g.id);
        const devicesByGroupId = await listMembershipsBulk(ids);
        if (refreshScopeGuard.isStale(token)) return;

        // Re-read groups.value AFTER the awaits so concurrent mutations
        // (single-group refetch, member updates) survive the merge.
        const next = {...groups.value};
        for (const gid in next) if (affects(next[gid])) delete next[gid];
        for (const g of items) {
            next[g.id] = {
                ...g,
                devices: devicesByGroupId[g.id] ?? [],
                members: next[g.id]?.members ?? []
            };
        }
        groups.value = next;
    }

    async function fetchGroups() {
        try {
            await refreshScope(
                {parentGroupId: null},
                (g) => g.parentGroupId == null
            );
        } catch (e) {
            console.error('[groups] fetchGroups failed', e);
            // Use toastRpcError so 401/403 (initial-load WS race, token
            // renewal in flight) don't surface as a user-visible toast —
            // the auth state machine handles those. Pattern mirrors
            // locations.ts / integrations.ts / assignments.ts.
            toastRpcError(toast, e, 'Failed to load groups');
        } finally {
            loading.value = false;
        }
    }

    async function fetchChildren(parentGroupId: number) {
        try {
            await refreshScope(
                {parentGroupId},
                (g) => g.parentGroupId === parentGroupId
            );
        } catch (e) {
            console.error('[groups] fetchChildren failed', parentGroupId, e);
            toastRpcError(toast, e, 'Failed to load subgroups');
        }
    }

    async function fetchGroup(id: number) {
        // Read: snapshot before the RPC; a list refetch mid-flight wins.
        const token = refreshScopeGuard.current();
        try {
            const [group, members] = await Promise.all([
                ws.sendRPC<ApiGroup>('FLEET_MANAGER', 'group.get', {id}),
                listAllMembersForGroup(id)
            ]);
            if (!group || refreshScopeGuard.isStale(token)) return;
            groups.value = {
                ...groups.value,
                [id]: {...group, devices: deviceIdsFrom(members), members}
            };
        } catch (e) {
            console.error('[groups] fetchGroup failed', id, e);
            toastRpcError(toast, e, 'Failed to load group');
        }
    }

    // Safe post-mutation refresh — add/remove batch fns are idempotent.
    async function fetchMembers(id: number): Promise<string[]> {
        try {
            const members = await listAllMembersForGroup(id);
            const devices = deviceIdsFrom(members);
            const g = groups.value[id];
            if (g) groups.value[id] = {...g, devices, members};
            return devices;
        } catch (e) {
            console.error('[groups] fetchMembers failed', id, e);
            toastRpcError(toast, e, 'Failed to load group members');
            return groups.value[id]?.devices ?? [];
        }
    }

    async function addDevices(
        groupId: number,
        deviceIds: string[]
    ): Promise<boolean> {
        if (deviceIds.length === 0) return true;
        return mutateDeviceMembership({
            groupId,
            members: deviceMembers(deviceIds),
            mode: 'add',
            method: 'group.addmembers',
            failureMessage: 'Failed to add devices to group'
        });
    }

    async function removeDevices(
        groupId: number,
        deviceIds: string[]
    ): Promise<boolean> {
        if (deviceIds.length === 0) return true;
        return mutateDeviceMembership({
            groupId,
            members: deviceMembers(deviceIds),
            mode: 'remove',
            method: 'group.removemembers',
            failureMessage: 'Failed to remove devices from group'
        });
    }

    async function addMembers(
        groupId: number,
        members: GroupMemberRef[]
    ): Promise<boolean> {
        if (members.length === 0) return true;
        return mutateDeviceMembership({
            groupId,
            members,
            mode: 'add',
            method: 'group.addmembers',
            failureMessage: 'Failed to add members to group'
        });
    }

    async function removeMembers(
        groupId: number,
        members: GroupMemberRef[]
    ): Promise<boolean> {
        if (members.length === 0) return true;
        return mutateDeviceMembership({
            groupId,
            members,
            mode: 'remove',
            method: 'group.removemembers',
            failureMessage: 'Failed to remove members from group'
        });
    }

    async function mutateDeviceMembership(input: {
        groupId: number;
        members: GroupMemberRef[];
        mode: MembershipMutationMode;
        method: 'group.addmembers' | 'group.removemembers';
        failureMessage: string;
    }): Promise<boolean> {
        try {
            await runOptimisticMutation({
                snapshot: () => snapshotGroup(input.groupId),
                apply: () => applyDeviceMembership(input),
                commit: () => commitDeviceMembership(input),
                rollback: restoreGroupSnapshot,
                reconcile: async () => {
                    await fetchMembers(input.groupId);
                },
                onError: (err) =>
                    toastRpcError(toast, err, input.failureMessage)
            });
            return true;
        } catch {
            return false;
        }
    }

    function snapshotGroup(groupId: number): StoreGroup | undefined {
        return groups.value[groupId];
    }

    function restoreGroupSnapshot(previous: StoreGroup | undefined): void {
        if (!previous) return;
        groups.value = {...groups.value, [previous.id]: previous};
    }

    function applyDeviceMembership(input: {
        groupId: number;
        members: GroupMemberRef[];
        mode: MembershipMutationMode;
    }): void {
        const group = groups.value[input.groupId];
        if (!group) return;
        const next =
            input.mode === 'add'
                ? withAddedMembers(group, input.members)
                : withRemovedMembers(group, input.members);
        groups.value = {...groups.value, [input.groupId]: next};
    }

    function withAddedMembers(
        group: StoreGroup,
        membersToAdd: GroupMemberRef[]
    ): StoreGroup {
        const current = currentMembersWithDeviceFallback(group);
        const memberKeys = new Set(current.map(subjectRefKey));
        const members = [...current];
        for (const ref of membersToAdd) {
            if (!memberKeys.has(subjectRefKey(ref))) members.push(ref);
        }
        return {...group, devices: deviceIdsFrom(members), members};
    }

    function withRemovedMembers(
        group: StoreGroup,
        membersToRemove: GroupMemberRef[]
    ): StoreGroup {
        const current = currentMembersWithDeviceFallback(group);
        const removeKeys = new Set(membersToRemove.map(subjectRefKey));
        const members = current.filter(
            (member) => !removeKeys.has(subjectRefKey(member))
        );
        return {
            ...group,
            devices: deviceIdsFrom(members),
            members
        };
    }

    async function commitDeviceMembership(input: {
        groupId: number;
        members: GroupMemberRef[];
        method: 'group.addmembers' | 'group.removemembers';
    }): Promise<void> {
        for (const batch of memberBatches(input.members)) {
            await ws.sendRPC('FLEET_MANAGER', input.method, {
                id: input.groupId,
                members: batch
            });
        }
    }

    async function createGroup(input: {
        name: string;
        metadata?: Record<string, unknown>;
        groupType?: string;
        kind?: string;
        members?: GroupMemberRef[];
    }): Promise<ApiGroup> {
        const created = await ws.sendRPC<ApiGroup>(
            'FLEET_MANAGER',
            'group.create',
            {
                name: input.name,
                metadata: input.metadata ?? {},
                groupType: input.groupType,
                kind: input.kind
            }
        );
        if (created?.id && input.members?.length) {
            await addMembers(created.id, input.members);
        }
        return created;
    }

    async function updateGroup(input: {
        id: number;
        expectedRevision?: number;
        patch: {
            name?: string;
            metadata?: Record<string, unknown>;
            kind?: string;
            visual?: {icon?: string; accent?: string};
            imageAssetId?: string | null;
        };
    }): Promise<void> {
        await ws.sendRPC('FLEET_MANAGER', 'group.update', input);
    }

    async function deleteGroup(id: number): Promise<void> {
        await ws.sendRPC('FLEET_MANAGER', 'group.delete', {id});
    }

    async function moveDevices(
        fromGroupId: number,
        toGroupId: number,
        deviceIds: string[]
    ): Promise<boolean> {
        if (fromGroupId === toGroupId || deviceIds.length === 0) return true;
        const added = await addDevices(toGroupId, deviceIds);
        if (!added) return false;
        return removeDevices(fromGroupId, deviceIds);
    }

    async function listActivity(params: {
        id: number;
        from?: string;
        to?: string;
        eventTypes?: string[];
        includeDescendants?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<{
        items: GroupActivityEntry[];
        total: number;
        limit: number;
        offset: number;
        has_more: boolean;
    }> {
        try {
            return await ws.sendRPC(
                'FLEET_MANAGER',
                'group.listactivity',
                params
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load group activity');
            return {items: [], total: 0, limit: 0, offset: 0, has_more: false};
        }
    }

    return {
        groups,
        loading,
        fetchGroups,
        fetchChildren,
        fetchGroup,
        fetchMembers,
        createGroup,
        updateGroup,
        deleteGroup,
        addDevices,
        removeDevices,
        addMembers,
        removeMembers,
        moveDevices,
        listActivity
    };
});

function deviceIdsFrom(members: GroupMemberRef[]): string[] {
    return members
        .filter((member) => member.subjectType === 'device')
        .map((member) => member.subjectId);
}

function currentMembersWithDeviceFallback(group: StoreGroup): GroupMemberRef[] {
    if (group.devices.length === 0) return group.members;
    const memberKeys = new Set(group.members.map(subjectRefKey));
    const missingDevices = group.devices
        .map(
            (subjectId): GroupMemberRef => ({subjectType: 'device', subjectId})
        )
        .filter((member) => !memberKeys.has(subjectRefKey(member)));
    return missingDevices.length === 0
        ? group.members
        : [...group.members, ...missingDevices];
}
