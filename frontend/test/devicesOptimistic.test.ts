import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    connect: vi.fn(),
    close: vi.fn()
}));
vi.mock('@/tools/http', () => ({sendRPC: vi.fn()}));

import {useDevicesStore} from '@/stores/devices';
import type {ShellyDeviceExternal} from '@/types/device';

function realDevice(shellyID: string, id: number): ShellyDeviceExternal {
    return {
        id,
        presence: 'online',
        shellyID,
        source: 'ws',
        info: {model: 'SPEM-003', gen: 2},
        status: {} as ShellyDeviceExternal['status'],
        _statusTs: 1,
        settings: {} as ShellyDeviceExternal['settings'],
        _settingsTs: undefined,
        selected: false,
        kvs: {},
        entities: ['switch:0'],
        capabilities: {} as ShellyDeviceExternal['capabilities'],
        meta: {},
        methods: []
    };
}

const waitingRoomStatus = (model: string): ShellyDeviceExternal['status'] =>
    ({sys: {gen: 2, device: {model}}}) as ShellyDeviceExternal['status'];

describe('devices store — optimistic onboarding', () => {
    beforeEach(() => setActivePinia(createPinia()));

    it('shows a provisional device instantly from waiting-room status', () => {
        const store = useDevicesStore();
        store.addOptimisticDevice('shelly-x', waitingRoomStatus('SPEM-003'));
        const d = store.devices['shelly-x'];
        expect(d).toBeTruthy();
        expect(d.shellyID).toBe('shelly-x');
        // Model carried over from the waiting-room status so the fleet row
        // renders immediately, before the real probe/build lands.
        expect(d.info?.model).toBe('SPEM-003');
        expect(d.status).toEqual(waitingRoomStatus('SPEM-003'));
    });

    it('the real build merges over the provisional — no duplicate, real data wins', () => {
        const store = useDevicesStore();
        store.addOptimisticDevice(
            'shelly-x',
            {} as ShellyDeviceExternal['status']
        );
        store.handleNewDevice(realDevice('shelly-x', 42));
        const keys = Object.keys(store.devices).filter((k) => k === 'shelly-x');
        expect(keys).toHaveLength(1);
        expect(store.devices['shelly-x'].id).toBe(42);
    });

    it('never clobbers an already-known real device', () => {
        const store = useDevicesStore();
        store.handleNewDevice(realDevice('shelly-y', 7));
        store.addOptimisticDevice(
            'shelly-y',
            {} as ShellyDeviceExternal['status']
        );
        expect(store.devices['shelly-y'].id).toBe(7);
    });
});
