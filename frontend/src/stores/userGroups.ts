import type {
    UserGroupCreateParams,
    UserGroupResponse,
    UserGroupUpdateParams
} from '@api/user_group';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {useAuthStore} from '@/stores/auth';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import {debugWarn} from '@/tools/debug';
import * as ws from '../tools/websocket';
import {createRefreshCoordinator} from './refreshCoordinator';
import {useToastStore} from './toast';

export type {UserGroupResponse};

export const useUserGroupsStore = defineStore('userGroups', () => {
    const groups = ref<Record<string, UserGroupResponse>>({});
    const members = ref<Record<string, string[]>>({});
    const loading = ref(false);
    const toast = useToastStore();
    const auth = useAuthStore();

    let latestFetchAllResult: UserGroupResponse[] = [];
    const fetchAllRefresh = createRefreshCoordinator(refreshUserGroups);

    async function fetchAll(): Promise<UserGroupResponse[]> {
        await fetchAllRefresh.request();
        return latestFetchAllResult;
    }

    async function refreshUserGroups(): Promise<void> {
        loading.value = true;
        try {
            const res = await ws.sendRPC<{items: UserGroupResponse[]}>(
                'FLEET_MANAGER',
                'user_group.list',
                {}
            );
            const next: Record<string, UserGroupResponse> = {};
            for (const g of res.items) next[g.id] = g;
            groups.value = next;
            latestFetchAllResult = res.items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load user groups');
            latestFetchAllResult = [];
        } finally {
            loading.value = false;
        }
    }

    async function fetch(id: string): Promise<UserGroupResponse | null> {
        try {
            const g = await ws.sendRPC<UserGroupResponse>(
                'FLEET_MANAGER',
                'user_group.get',
                {id}
            );
            groups.value = {...groups.value, [g.id]: g};
            return g;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load user group');
            return null;
        }
    }

    async function create(
        params: UserGroupCreateParams
    ): Promise<UserGroupResponse | null> {
        try {
            const g = await ws.sendRPC<UserGroupResponse>(
                'FLEET_MANAGER',
                'user_group.create',
                params
            );
            groups.value = {...groups.value, [g.id]: g};
            return g;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create user group');
            return null;
        }
    }

    async function update(
        params: UserGroupUpdateParams
    ): Promise<UserGroupResponse | null> {
        try {
            const g = await ws.sendRPC<UserGroupResponse>(
                'FLEET_MANAGER',
                'user_group.update',
                params
            );
            groups.value = {...groups.value, [g.id]: g};
            return g;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update user group');
            return null;
        }
    }

    async function remove(id: string): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'user_group.delete', {id});
            const next = {...groups.value};
            delete next[id];
            groups.value = next;
            const m = {...members.value};
            delete m[id];
            members.value = m;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete user group');
            return false;
        }
    }

    async function fetchMembers(id: string): Promise<string[]> {
        try {
            const res = await ws.sendRPC<{userIds: string[]}>(
                'FLEET_MANAGER',
                'user_group.listmembers',
                {id}
            );
            members.value = {...members.value, [id]: res.userIds};
            return res.userIds;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load group members');
            return [];
        }
    }

    async function addMembers(id: string, userIds: string[]): Promise<boolean> {
        return mutateMembers({
            id,
            userIds,
            mode: 'add',
            method: 'user_group.addmembers',
            failureMessage: 'Failed to add group members'
        });
    }

    async function removeMembers(
        id: string,
        userIds: string[]
    ): Promise<boolean> {
        return mutateMembers({
            id,
            userIds,
            mode: 'remove',
            method: 'user_group.removemembers',
            failureMessage: 'Failed to remove group members'
        });
    }

    type MemberMutationMode = 'add' | 'remove';

    async function mutateMembers(input: {
        id: string;
        userIds: string[];
        mode: MemberMutationMode;
        method: 'user_group.addmembers' | 'user_group.removemembers';
        failureMessage: string;
    }): Promise<boolean> {
        if (input.userIds.length === 0) return true;
        try {
            await runOptimisticMutation({
                snapshot: () => snapshotMembers(input.id),
                apply: () => applyMemberMutation(input),
                commit: () => commitMemberMutation(input),
                rollback: (previous) => restoreMembers(input.id, previous),
                reconcile: async () => {
                    await fetchMembers(input.id);
                    await refreshCurrentUserAccessIfAffected(input.userIds);
                },
                onError: (err) =>
                    toastRpcError(toast, err, input.failureMessage)
            });
            return true;
        } catch (error) {
            debugWarn('user group member mutation failed', {
                groupId: input.id,
                error
            });
            return false;
        }
    }

    function snapshotMembers(id: string): string[] | undefined {
        return members.value[id];
    }

    function restoreMembers(id: string, previous: string[] | undefined): void {
        const next = {...members.value};
        if (previous === undefined) {
            delete next[id];
        } else {
            next[id] = previous;
        }
        members.value = next;
    }

    function applyMemberMutation(input: {
        id: string;
        userIds: string[];
        mode: MemberMutationMode;
    }): void {
        const current = members.value[input.id] ?? [];
        members.value = {
            ...members.value,
            [input.id]:
                input.mode === 'add'
                    ? withAddedMembers(current, input.userIds)
                    : withoutRemovedMembers(current, input.userIds)
        };
    }

    function withAddedMembers(current: string[], userIds: string[]): string[] {
        return Array.from(new Set([...current, ...userIds]));
    }

    function withoutRemovedMembers(
        current: string[],
        userIds: string[]
    ): string[] {
        const remove = new Set(userIds);
        return current.filter((userId) => !remove.has(userId));
    }

    async function commitMemberMutation(input: {
        id: string;
        userIds: string[];
        method: 'user_group.addmembers' | 'user_group.removemembers';
    }): Promise<void> {
        await ws.sendRPC('FLEET_MANAGER', input.method, {
            id: input.id,
            userIds: input.userIds
        });
    }

    async function refreshCurrentUserAccessIfAffected(
        userIds: string[]
    ): Promise<void> {
        const currentUserId = auth.currentUserId;
        if (!currentUserId || !userIds.includes(currentUserId)) return;
        await auth.fetchUserPermissions({rerunIfBusy: true});
    }

    return {
        groups,
        members,
        loading,
        fetchAll,
        fetch,
        create,
        update,
        remove,
        fetchMembers,
        addMembers,
        removeMembers
    };
});
