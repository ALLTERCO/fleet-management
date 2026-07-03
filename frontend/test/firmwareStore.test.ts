import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const wsCallbacks = vi.hoisted(() => ({
    job: [] as Array<(event: any) => void>
}));

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    onJobEvent: vi.fn((cb: (event: any) => void) => {
        wsCallbacks.job.push(cb);
        return vi.fn();
    }),
    onResyncRequired: vi.fn()
}));

vi.mock('@/tools/observability', () => ({
    trackInteraction: vi.fn()
}));

vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        canExecuteDevice: () => true
    })
}));

vi.mock('@/stores/groups', () => ({
    useGroupsStore: () => ({
        groups: {}
    })
}));

import {useDevicesStore} from '@/stores/devices';
import {useFirmwareStore} from '@/stores/firmware';
import {sendRPC} from '@/tools/websocket';

function seedFirmwareCapableDevice(shellyID: string): void {
    useDevicesStore().devices[shellyID] = {
        shellyID,
        online: true,
        capabilities: {
            firmwareUpdate: true,
            firmwareCheck: true
        },
        info: {
            model: 'SNSW-001X16EU',
            name: shellyID,
            ver: '1.0.0',
            fw_id: 'fw/old'
        },
        status: {
            sys: {
                available_updates: {
                    stable: {version: '1.1.0', build_id: 'new'}
                }
            }
        }
    } as any;
}

function emitJobEvent(event: any): void {
    for (const callback of wsCallbacks.job) callback(event);
}

describe('firmwareStore backend jobs', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        wsCallbacks.job = [];
        globalThis.localStorage.clear();
        vi.mocked(sendRPC).mockImplementation(
            async (_service: string, method: string) => {
                if (method === 'Firmware.GetAutoUpdateModes') {
                    return {items: []};
                }
                if (method === 'Firmware.StartUpdateJob') {
                    return {jobId: 'firmware-job-1'};
                }
                return {};
            }
        );
    });

    it('starts firmware updates as backend jobs', async () => {
        seedFirmwareCapableDevice('dev-1');
        const store = useFirmwareStore();
        store.toggleDevice('dev-1');
        store.initializeFirmwareInfo();

        await store.updateSelected('stable');

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Firmware.StartUpdateJob',
            expect.objectContaining({
                shellyIDs: ['dev-1'],
                channel: 'stable'
            })
        );
        expect(sendRPC).not.toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'Shelly.Update',
            expect.anything()
        );
    });

    it('applies firmware progress only from the active backend job', async () => {
        seedFirmwareCapableDevice('dev-1');
        const store = useFirmwareStore();
        store.toggleDevice('dev-1');
        store.initializeFirmwareInfo();

        await store.updateSelected('stable');

        emitJobEvent({
            method: 'Job.UnitUpdated',
            params: {
                jobId: 'other-firmware-job',
                kind: 'firmware',
                unitId: '1',
                status: 'failed',
                deviceId: 'dev-1',
                error: 'wrong job'
            }
        });

        expect(store.firmwareInfo['dev-1']?.updateStatus).toBe('downloading');

        emitJobEvent({
            method: 'Job.UnitUpdated',
            params: {
                jobId: 'firmware-job-1',
                kind: 'firmware',
                unitId: '2',
                status: 'done',
                deviceId: 'dev-1',
                result: {
                    finalVersion: '1.1.0',
                    finalFwId: 'fw/new',
                    message: 'Updated firmware build to new'
                }
            }
        });

        expect(store.firmwareInfo['dev-1']?.updateStatus).toBe('success');
        expect(store.firmwareInfo['dev-1']?.currentVersion).toBe('1.1.0');
        expect(useDevicesStore().devices['dev-1']?.info?.fw_id).toBe('fw/new');
    });
});
