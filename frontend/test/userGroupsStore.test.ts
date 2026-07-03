import type {UserGroupResponse} from '@api/user_group';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, toastError, authStore} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    toastError: vi.fn(),
    authStore: {
        currentUserId: 'current-user',
        fetchUserPermissions: vi.fn()
    }
}));

vi.mock('@/tools/websocket', () => ({sendRPC}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));
vi.mock('@/stores/auth', () => ({
    useAuthStore: () => authStore
}));

import {useUserGroupsStore} from '@/stores/userGroups';

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    const promise = new Promise<Result>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}

function userGroup(fields: Partial<UserGroupResponse> = {}): UserGroupResponse {
    return {
        id: 'group-1',
        tenant_id: 'org',
        name: 'Operators',
        description: null,
        parent_group_id: null,
        member_count: 0,
        created_at: '2026-05-22T00:00:00.000Z',
        ...fields
    };
}

async function waitForRpcCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (sendRPC.mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(sendRPC).toHaveBeenCalledTimes(count);
}

describe('userGroups store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        toastError.mockReset();
        authStore.currentUserId = 'current-user';
        authStore.fetchUserPermissions.mockReset();
    });

    it('addMembers applies membership before user_group.addmembers resolves', async () => {
        const rpc = deferred<void>();
        sendRPC.mockImplementation(async (_namespace, method) => {
            if (method === 'user_group.addmembers') return rpc.promise;
            if (method === 'user_group.listmembers') {
                return {userIds: ['user-a', 'user-b']};
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useUserGroupsStore();
        store.members = {'group-1': ['user-a']};

        const pending = store.addMembers('group-1', ['user-b']);

        expect(store.members['group-1']).toEqual(['user-a', 'user-b']);
        await Promise.resolve();
        await Promise.resolve();
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'user_group.addmembers',
            {
                id: 'group-1',
                userIds: ['user-b']
            }
        );

        rpc.resolve();
        await pending;

        expect(store.members['group-1']).toEqual(['user-a', 'user-b']);
    });

    it('refreshes backend auth when current-user membership changes', async () => {
        sendRPC.mockImplementation(async (_namespace, method) => {
            if (method === 'user_group.addmembers') return undefined;
            if (method === 'user_group.listmembers') {
                return {userIds: ['current-user']};
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useUserGroupsStore();

        const ok = await store.addMembers('group-1', ['current-user']);

        expect(ok).toBe(true);
        expect(authStore.fetchUserPermissions).toHaveBeenCalledTimes(1);
    });

    it('does not refresh backend auth before optimistic current-user membership is committed', async () => {
        const rpc = deferred<void>();
        sendRPC.mockImplementation(async (_namespace, method) => {
            if (method === 'user_group.addmembers') return rpc.promise;
            if (method === 'user_group.listmembers') {
                return {userIds: ['current-user']};
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useUserGroupsStore();
        const pending = store.addMembers('group-1', ['current-user']);

        expect(store.members['group-1']).toEqual(['current-user']);
        expect(authStore.fetchUserPermissions).not.toHaveBeenCalled();

        rpc.resolve();
        await pending;

        expect(authStore.fetchUserPermissions).toHaveBeenCalledTimes(1);
    });

    it('does not refresh backend auth for other-user membership changes', async () => {
        sendRPC.mockImplementation(async (_namespace, method) => {
            if (method === 'user_group.addmembers') return undefined;
            if (method === 'user_group.listmembers') {
                return {userIds: ['other-user']};
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useUserGroupsStore();

        const ok = await store.addMembers('group-1', ['other-user']);

        expect(ok).toBe(true);
        expect(authStore.fetchUserPermissions).not.toHaveBeenCalled();
    });

    it('removeMembers restores membership when user_group.removemembers fails', async () => {
        sendRPC.mockImplementation(async (_namespace, method) => {
            if (method === 'user_group.removemembers') {
                throw new Error('denied');
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useUserGroupsStore();
        store.members = {'group-1': ['user-a', 'user-b']};

        const ok = await store.removeMembers('group-1', ['user-b']);

        expect(ok).toBe(false);
        expect(store.members['group-1']).toEqual(['user-a', 'user-b']);
        expect(toastError).toHaveBeenCalled();
    });

    it('coalesces overlapping list refreshes into one follow-up refresh', async () => {
        const first = deferred<{items: UserGroupResponse[]}>();
        const second = deferred<{items: UserGroupResponse[]}>();
        sendRPC
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useUserGroupsStore();

        const firstFetch = store.fetchAll();
        const secondFetch = store.fetchAll();

        expect(sendRPC).toHaveBeenCalledTimes(1);
        first.resolve({items: [userGroup({id: 'old', name: 'Old'})]});
        await waitForRpcCount(2);
        second.resolve({items: [userGroup({id: 'fresh', name: 'Fresh'})]});

        await expect(Promise.all([firstFetch, secondFetch])).resolves.toEqual([
            [expect.objectContaining({id: 'fresh', name: 'Fresh'})],
            [expect.objectContaining({id: 'fresh', name: 'Fresh'})]
        ]);
        expect(store.groups).toEqual({
            fresh: expect.objectContaining({name: 'Fresh'})
        });
    });
});
