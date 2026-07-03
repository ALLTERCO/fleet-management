import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({sendRPC}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

import type {DestinationGroup, DestinationMemberRef} from '@api/notification';
import {useDestinationsStore} from '@/stores/destinations';

function destination(id: number): DestinationGroup {
    return {
        id,
        organizationId: 'org',
        name: `Destination ${id}`,
        description: null,
        enabled: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
        counts: {members: 1, rulesReferencing: 0}
    };
}

function user(id: string): DestinationMemberRef {
    return {memberType: 'user', memberId: id};
}

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    const promise = new Promise<Result>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}

describe('destinations store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        toastError.mockReset();
    });

    it('addMembers applies members and count before addmembers resolves', async () => {
        const rpc = deferred<void>();
        sendRPC.mockImplementation(async (_namespace, method) => {
            if (method === 'notification.destination.addmembers') {
                return rpc.promise;
            }
            if (method === 'notification.destination.listmembers') {
                return {
                    items: [user('user-a'), user('user-b')],
                    total: 2,
                    limit: 1000,
                    offset: 0,
                    has_more: false
                };
            }
            if (method === 'notification.destination.get') {
                return {
                    ...destination(1),
                    counts: {members: 2, rulesReferencing: 0}
                };
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useDestinationsStore();
        store.destinations = {1: destination(1)};
        store.members = {1: [user('user-a')]};

        const pending = store.addMembers(1, [user('user-b')]);

        expect(store.members[1]).toEqual([user('user-a'), user('user-b')]);
        expect(store.destinations[1].counts.members).toBe(2);

        rpc.resolve();
        await pending;

        expect(store.members[1]).toEqual([user('user-a'), user('user-b')]);
    });

    it('removeMembers restores members and count when removemembers fails', async () => {
        sendRPC.mockImplementation(async (_namespace, method) => {
            if (method === 'notification.destination.removemembers') {
                throw new Error('denied');
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useDestinationsStore();
        store.destinations = {1: destination(1)};
        store.members = {1: [user('user-a'), user('user-b')]};

        const ok = await store.removeMembers(1, [user('user-b')]);

        expect(ok).toBe(false);
        expect(store.members[1]).toEqual([user('user-a'), user('user-b')]);
        expect(store.destinations[1].counts.members).toBe(1);
        expect(toastError).toHaveBeenCalled();
    });
});
