// Integration: dashboards store + ordering composable + recents composable
// + delete helpers — drives the real flows the palette and manage page use,
// stopping at the WS sendRPC boundary.

import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/helpers/zitadelAuth', () => ({
    initZitadelAuth: vi.fn().mockResolvedValue(undefined),
    getZitadelAuth: vi.fn().mockReturnValue(undefined),
    setAuthLifecycleHandlers: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    sendRPC: vi.fn(),
    onAlertEvent: vi.fn(() => () => undefined),
    onDashboardEvent: vi.fn(() => () => undefined),
    onLocationEvent: vi.fn(() => () => undefined),
    onJobEvent: vi.fn(() => () => undefined),
    onResyncRequired: vi.fn(() => () => undefined),
    onCertificateEvent: vi.fn(() => () => undefined),
    onCredentialEvent: vi.fn(() => () => undefined),
    onComponentEvent: vi.fn(() => () => undefined),
    onNotificationEvent: vi.fn(() => () => undefined),
    onWaitingRoomUpdated: vi.fn(() => () => undefined),
    onOtaProgress: vi.fn(() => () => undefined)
}));

import {createPinia, setActivePinia} from 'pinia';
import {
    __resetDashboardOrderCacheForTests,
    useDashboardOrder
} from '@/composables/useDashboardOrder';
import {
    __resetRecentDashboardsCacheForTests,
    useRecentDashboards
} from '@/composables/useRecentDashboards';
import {useDashboardsStore} from '@/stores/dashboards';
import * as ws from '@/tools/websocket';

const mockedSendRPC = vi.mocked(ws.sendRPC);

function fakeDashboard(overrides: Record<string, unknown>) {
    return {
        id: 42,
        organizationId: 1,
        name: 'Test',
        dashboardType: 'classic',
        scope: {},
        isDefault: false,
        isPinned: false,
        settings: {},
        createdAt: '2026-05-28T00:00:00Z',
        updatedAt: null,
        items: [],
        ...overrides
    };
}

describe('integration: create → store upsert → recents touch', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
        __resetDashboardOrderCacheForTests();
        __resetRecentDashboardsCacheForTests();
        mockedSendRPC.mockReset();
    });

    it('persists the new dashboard in the store and marks it recent', async () => {
        const store = useDashboardsStore();
        const recents = useRecentDashboards({scopeKey: 'user-1'});
        mockedSendRPC.mockResolvedValueOnce(
            fakeDashboard({id: 7, name: 'New'})
        );

        const created = await store.create({
            name: 'New',
            dashboardType: 'classic'
        });
        expect(created?.id).toBe(7);
        expect(store.dashboards[7]?.name).toBe('New');

        recents.touch(7);
        expect(recents.ids.value).toEqual([7]);
    });
});

describe('integration: remove → order purge → recents forget', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
        __resetDashboardOrderCacheForTests();
        __resetRecentDashboardsCacheForTests();
        mockedSendRPC.mockReset();
    });

    it('drops the id from store, order, and recents on a successful remove', async () => {
        const store = useDashboardsStore();
        store.upsert(fakeDashboard({id: 9}));
        const order = useDashboardOrder();
        order.replace([9, 1, 2]);
        const recents = useRecentDashboards({scopeKey: 'user-1'});
        recents.touch(9);

        mockedSendRPC.mockResolvedValueOnce(undefined);
        const ok = await store.remove(9);

        expect(ok).toBe(true);
        expect(store.dashboards[9]).toBeUndefined();

        order.purge([9]);
        recents.forget(9);
        expect(order.ids.value).toEqual([1, 2]);
        expect(recents.ids.value).toEqual([]);
    });

    it('does not invoke the RPC when the id is not a finite integer', async () => {
        const store = useDashboardsStore();
        const before = mockedSendRPC.mock.calls.length;
        const ok = await store.remove(Number.NaN);
        expect(ok).toBe(false);
        expect(mockedSendRPC.mock.calls.length).toBe(before);
    });
});

describe('integration: dashboard order singleton is shared across consumers', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
        __resetDashboardOrderCacheForTests();
    });

    it('a move from one caller is observed by every other caller', () => {
        const callerA = useDashboardOrder();
        const callerB = useDashboardOrder();
        callerA.replace([1, 2, 3, 4]);
        callerB.move([1, 2, 3, 4], 3, -1);
        expect(callerA.ids.value).toEqual([1, 3, 2, 4]);
        expect(callerB.ids.value).toEqual([1, 3, 2, 4]);
    });

    it('survives a fresh caller mounting after the order was set elsewhere', () => {
        useDashboardOrder().replace([10, 20]);
        // Fresh caller — same singleton.
        expect(useDashboardOrder().ids.value).toEqual([10, 20]);
        // And localStorage has it for cold-start.
        const stored = JSON.parse(
            localStorage.getItem('fm-dashboard-order') ?? '[]'
        );
        expect(stored).toEqual([10, 20]);
    });
});

describe('integration: recents survives auth scope change', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
        __resetRecentDashboardsCacheForTests();
    });

    it('keeps each scope isolated when a single consumer flips users', async () => {
        const {ref} = await import('vue');
        const scope = ref<string | null>(null);
        const recents = useRecentDashboards({scopeKey: () => scope.value});
        recents.touch(1); // anon bucket

        scope.value = 'user-x';
        expect(recents.ids.value).toEqual([]);
        recents.touch(99);

        scope.value = null; // back to anon
        expect(recents.ids.value).toEqual([1]);
    });
});
