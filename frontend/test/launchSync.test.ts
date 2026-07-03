import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const callbacks = vi.hoisted(() => ({
    waitingRoom: undefined as undefined | (() => void),
    alert: undefined as undefined | ((event: {method: string}) => void)
}));

vi.mock('@/tools/websocket', () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    onWaitingRoomUpdated: vi.fn((cb: () => void) => {
        callbacks.waitingRoom = cb;
        return vi.fn();
    }),
    onAlertEvent: vi.fn((cb: (event: {method: string}) => void) => {
        callbacks.alert = cb;
        return vi.fn();
    })
}));

vi.mock('@/tools/http', () => ({
    sendRPC: vi.fn()
}));

vi.mock('@/helpers/zitadelAuth', () => ({
    initZitadelAuth: vi.fn().mockResolvedValue(undefined),
    getZitadelAuth: vi.fn().mockReturnValue(undefined),
    setAuthLifecycleHandlers: vi.fn()
}));

import {useAuthStore} from '@/stores/auth';
import {sendRPC} from '@/tools/http';
import {initLaunchSync} from '@/tools/launchSync';

function bootstrapResponse(waitingRoomVisible = true) {
    return {
        serverTime: '2026-05-22T00:00:00.000Z',
        user: {username: 'admin', organizationId: 'org', isAdmin: true},
        permissions: {
            roles: ['admin'],
            group: 'admin',
            canWrite: true,
            isAdmin: true,
            isViewer: false
        },
        devices: {visible: true, items: [], total: 0},
        waitingRoom: {
            visible: waitingRoomVisible,
            pendingCount: 2,
            pending: {'1': {shellyID: 'one'}}
        },
        alerts: {visible: true, openCount: 0, criticalCount: 0}
    };
}

async function loadBootstrap(waitingRoomVisible = true): Promise<void> {
    vi.mocked(sendRPC).mockResolvedValueOnce(
        bootstrapResponse(waitingRoomVisible)
    );
    const auth = useAuthStore();
    auth.status = 'booting';
    await auth.fetchUserPermissions();
    vi.mocked(sendRPC).mockClear();
}

describe('launchSync', () => {
    beforeEach(async () => {
        setActivePinia(createPinia());
        vi.useFakeTimers();
        vi.clearAllMocks();
        callbacks.waitingRoom = undefined;
        callbacks.alert = undefined;
        localStorage.clear();
        await loadBootstrap();
        initLaunchSync();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses lightweight waiting-room counts for waiting-room events', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({pendingCount: 7});

        callbacks.waitingRoom?.();
        await vi.runOnlyPendingTimersAsync();

        expect(sendRPC).toHaveBeenCalledWith('WaitingRoom.GetCounts', {});
        expect(sendRPC).not.toHaveBeenCalledWith(
            'Mobile.SyncDelta',
            expect.anything()
        );
        expect(useAuthStore().launchBootstrap?.waitingRoom.pendingCount).toBe(
            7
        );
        expect(useAuthStore().launchBootstrap?.waitingRoom.pending).toEqual({
            '1': {shellyID: 'one'}
        });
    });

    it('refreshes alert counts on alert update events', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            serverTime: '2026-05-22T00:01:00.000Z',
            devices: {visible: false, changed: []},
            waitingRoom: {visible: false, pendingCount: 0, pending: {}},
            alerts: {visible: true, openCount: 3, criticalCount: 1}
        });

        callbacks.alert?.({method: 'Alert.Updated'});
        await vi.runOnlyPendingTimersAsync();

        expect(sendRPC).toHaveBeenCalledWith('Mobile.SyncDelta', {
            since: '2026-05-22T00:00:00.000Z'
        });
        expect(useAuthStore().launchBootstrap?.alerts.openCount).toBe(3);
        expect(useAuthStore().launchBootstrap?.alerts.criticalCount).toBe(1);
    });

    it('skips waiting-room count refresh when waiting room is not visible', async () => {
        setActivePinia(createPinia());
        await loadBootstrap(false);
        initLaunchSync();

        callbacks.waitingRoom?.();
        await vi.runOnlyPendingTimersAsync();

        expect(sendRPC).not.toHaveBeenCalled();
    });
});
