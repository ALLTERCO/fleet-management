import type {Dashboard} from '@api/dashboard';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {toastRpcError} from '@/helpers/domainErrors';
import {useDashboardsStore} from '@/stores/dashboards';
import {sendRPC} from '@/tools/websocket';

vi.mock('@/helpers/domainErrors', () => ({
    toastRpcError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    onDashboardEvent: vi.fn(),
    sendRPC: vi.fn()
}));

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function dashboard(fields: Partial<Dashboard> = {}): Dashboard {
    return {
        id: 7,
        organizationId: 'org',
        name: 'Energy',
        dashboardType: 'energy',
        scope: {},
        isDefault: false,
        isPinned: false,
        settings: {} as Dashboard['settings'],
        items: [],
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: null,
        ...fields
    } as Dashboard;
}

async function waitForRpcCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (vi.mocked(sendRPC).mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(sendRPC).toHaveBeenCalledTimes(count);
}

describe('dashboards store optimistic metadata updates', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.resetAllMocks();
    });

    it('applies scope changes before Dashboard.Update resolves', async () => {
        const rpc = deferred<Dashboard>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const store = useDashboardsStore();
        store.dashboards = {7: dashboard()};

        const command = store.update(7, {scope: {groupId: 3}});

        expect(store.dashboards[7].scope.groupId).toBe(3);
        rpc.resolve(dashboard({scope: {groupId: 3}}));
        await expect(command).resolves.toMatchObject({scope: {groupId: 3}});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Dashboard.Update',
            {
                id: 7,
                scope: {groupId: 3}
            }
        );
    });

    it('rolls back scope changes when Dashboard.Update fails', async () => {
        vi.mocked(sendRPC).mockRejectedValue(new Error('denied'));
        const store = useDashboardsStore();
        store.dashboards = {7: dashboard({scope: {groupId: 1}})};

        await expect(
            store.update(7, {scope: {groupId: 3}})
        ).resolves.toBeNull();

        expect(store.dashboards[7].scope.groupId).toBe(1);
        expect(toastRpcError).toHaveBeenCalledTimes(1);
    });

    it('applies item size changes before Dashboard.UpdateItemSize resolves', async () => {
        const rpc = deferred<void>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const store = useDashboardsStore();
        store.dashboards = {
            7: dashboard({items: [{id: 11, size: '1x1'}] as Dashboard['items']})
        };

        const command = store.updateItemSize({
            dashboardId: 7,
            itemId: 11,
            size: '2x2'
        });

        expect(store.dashboards[7].items[0].size).toBe('2x2');
        rpc.resolve();
        await expect(command).resolves.toBe(true);
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Dashboard.UpdateItemSize',
            {
                dashboard: 7,
                itemId: 11,
                size: '2x2'
            }
        );
    });

    it('rolls back item size changes when Dashboard.UpdateItemSize fails', async () => {
        vi.mocked(sendRPC).mockRejectedValue(new Error('denied'));
        const store = useDashboardsStore();
        store.dashboards = {
            7: dashboard({items: [{id: 11, size: '1x1'}] as Dashboard['items']})
        };

        await expect(
            store.updateItemSize({dashboardId: 7, itemId: 11, size: '2x2'})
        ).resolves.toBe(false);

        expect(store.dashboards[7].items[0].size).toBe('1x1');
        expect(toastRpcError).toHaveBeenCalledTimes(1);
    });

    it('coalesces overlapping list refreshes into one follow-up refresh', async () => {
        const first = deferred<{items: Dashboard[]; total: number}>();
        const second = deferred<{items: Dashboard[]; total: number}>();
        vi.mocked(sendRPC)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useDashboardsStore();

        const firstFetch = store.fetchAll();
        const secondFetch = store.fetchAll();

        expect(sendRPC).toHaveBeenCalledTimes(1);
        first.resolve({items: [dashboard({id: 1, name: 'Old'})], total: 1});
        await waitForRpcCount(2);
        second.resolve({items: [dashboard({id: 2, name: 'Fresh'})], total: 1});

        await expect(Promise.all([firstFetch, secondFetch])).resolves.toEqual([
            [expect.objectContaining({id: 2, name: 'Fresh'})],
            [expect.objectContaining({id: 2, name: 'Fresh'})]
        ]);
        expect(store.dashboards).toEqual({
            2: expect.objectContaining({name: 'Fresh'})
        });
    });
});
