import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({
    listDevicesSnapshot: vi.fn().mockResolvedValue([]),
    sendRPC: vi.fn()
}));

import {useDevicesStore} from '@/stores/devices';
import type {ShellyDeviceExternal} from '@/types';

const START_MS = Date.UTC(2026, 9, 30, 12, 0, 0);
const WAKEUP_SEC = 60;

function sleeperSnapshot(input?: {
    presence?: ShellyDeviceExternal['presence'];
    observedAtMs?: number;
}): ShellyDeviceExternal {
    const observedAtMs = input?.observedAtMs ?? Date.now();
    const unix = observedAtMs / 1000;
    return {
        id: 1,
        presence: input?.presence ?? 'offline',
        shellyID: 'sleeper-1',
        source: input?.presence === 'online' ? 'ws' : 'offline',
        info: {id: 'sleeper-1', model: 'battery-sleeper'},
        status: {
            ts: unix,
            sys: {unixtime: unix, wakeup_period: WAKEUP_SEC},
            'devicepower:0': {battery: {percent: 80}}
        },
        _statusTs: observedAtMs,
        settings: {sys: {sleep: {wakeup_period: WAKEUP_SEC}}},
        _settingsTs: observedAtMs,
        selected: false,
        kvs: {},
        entities: [],
        capabilities: {},
        meta: {lastReportTs: observedAtMs},
        methods: []
    };
}

describe('sleeping device liveness expiry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(START_MS);
        setActivePinia(createPinia());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('expires a sleeping offline device when its wakeup window elapses', () => {
        const store = useDevicesStore();
        store.handleNewDevice(sleeperSnapshot());

        expect(store.devices['sleeper-1']).toMatchObject({
            online: true,
            sleeping: true
        });
        expect(store.onlineCount).toBe(1);

        vi.advanceTimersByTime(WAKEUP_SEC * 1000 + 1);

        expect(store.devices['sleeper-1']).toMatchObject({
            online: false,
            sleeping: false
        });
        expect(store.onlineCount).toBe(0);
    });

    it('starts the same bounded sleep window on the disconnect route', () => {
        const store = useDevicesStore();
        store.handleNewDevice(sleeperSnapshot({presence: 'online'}));

        store.deviceDisconnected('sleeper-1');
        expect(store.devices['sleeper-1']).toMatchObject({
            online: true,
            sleeping: true
        });

        vi.advanceTimersByTime(WAKEUP_SEC * 1000 + 1);
        expect(store.devices['sleeper-1']).toMatchObject({
            online: false,
            sleeping: false
        });
    });

    it('does not let an old sleep deadline override a reconnect', () => {
        const store = useDevicesStore();
        store.handleNewDevice(sleeperSnapshot());

        vi.advanceTimersByTime(30_000);
        store.deviceConnected(
            sleeperSnapshot({presence: 'online', observedAtMs: Date.now()})
        );

        expect(store.devices['sleeper-1']).toMatchObject({
            online: true,
            sleeping: false
        });

        vi.advanceTimersByTime(90_000);

        expect(store.devices['sleeper-1']).toMatchObject({
            online: true,
            sleeping: false
        });
    });

    it('extends the sleep deadline when a fresh status payload is received', () => {
        const store = useDevicesStore();
        store.handleNewDevice(sleeperSnapshot());

        vi.advanceTimersByTime(50_000);
        const refreshedUnix = Date.now() / 1000;
        store.patchStatus(
            'sleeper-1',
            {ts: refreshedUnix, sys: {unixtime: refreshedUnix}},
            true
        );

        vi.advanceTimersByTime(11_000);
        expect(store.devices['sleeper-1']).toMatchObject({
            online: true,
            sleeping: true
        });

        vi.advanceTimersByTime(49_001);
        expect(store.devices['sleeper-1']).toMatchObject({
            online: false,
            sleeping: false
        });
    });

    it('does not treat a BLU gateway child battery as gateway sleep state', () => {
        const store = useDevicesStore();
        const unix = Date.now() / 1000;
        store.handleNewDevice({
            ...sleeperSnapshot(),
            shellyID: 'blu-gateway',
            source: 'offline',
            presence: 'offline',
            settings: {},
            status: {
                sys: {unixtime: unix},
                'bthomedevice:200': {battery: 88}
            },
            meta: {lastReportTs: Date.now()}
        });

        expect(store.devices['blu-gateway']).toMatchObject({
            online: false,
            sleeping: false
        });
    });
});
