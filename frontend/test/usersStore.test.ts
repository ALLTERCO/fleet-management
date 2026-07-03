import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useUsersStore, type ZitadelUser} from '@/stores/users';
import {sendRPC} from '@/tools/websocket';

const {toastError, toastSuccess, toastWarning} = vi.hoisted(() => ({
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    toastWarning: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn()
}));

vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({
        error: toastError,
        success: toastSuccess,
        warning: toastWarning
    })
}));

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    const promise = new Promise<Result>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}

function user(fields: Partial<ZitadelUser> = {}): ZitadelUser {
    return {
        userId: 'user-1',
        userName: 'user-1',
        email: 'user-1@example.com',
        ...fields
    };
}

async function waitForRpcCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (vi.mocked(sendRPC).mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(sendRPC).toHaveBeenCalledTimes(count);
}

describe('users store refresh coordination', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.mocked(sendRPC).mockReset();
        toastError.mockReset();
        toastSuccess.mockReset();
        toastWarning.mockReset();
    });

    it('coalesces overlapping user refreshes into one follow-up refresh', async () => {
        const first = deferred<{items: ZitadelUser[]}>();
        const second = deferred<{items: ZitadelUser[]}>();
        vi.mocked(sendRPC)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useUsersStore();

        const firstFetch = store.fetchUsers();
        const secondFetch = store.fetchUsers();

        expect(sendRPC).toHaveBeenCalledTimes(1);
        first.resolve({items: [user({userId: 'old', userName: 'Old'})]});
        await waitForRpcCount(2);
        second.resolve({
            items: [user({userId: 'fresh', userName: 'Fresh'})]
        });
        await Promise.all([firstFetch, secondFetch]);

        expect(store.users).toEqual([
            expect.objectContaining({userId: 'fresh', userName: 'Fresh'})
        ]);
        expect(store.fetchError).toBe('');
    });
});
