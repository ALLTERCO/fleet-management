import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
    executableIds: new Set([
        'visible-device',
        'hidden-device',
        'offline-device'
    ]),
    devices: {
        'visible-device': {
            shellyID: 'visible-device',
            online: true,
            capabilities: {backup: true}
        },
        'hidden-device': {
            shellyID: 'hidden-device',
            online: true,
            capabilities: {backup: true}
        },
        'offline-device': {
            shellyID: 'offline-device',
            online: false,
            capabilities: {backup: true}
        },
        'denied-device': {
            shellyID: 'denied-device',
            online: true,
            capabilities: {backup: true}
        },
        'unsupported-device': {
            shellyID: 'unsupported-device',
            online: true,
            capabilities: {backup: false}
        }
    }
}));

vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        canExecuteDevice: (shellyID: string) =>
            state.executableIds.has(shellyID)
    })
}));

vi.mock('@/stores/devices', () => ({
    useDevicesStore: () => ({
        devices: state.devices,
        devicesVersion: 0
    })
}));

vi.mock('@/stores/groups', () => ({
    useGroupsStore: () => ({groups: {}})
}));

import {useDeviceSelection} from '@/composables/useDeviceSelection';

describe('useDeviceSelection.selectAll', () => {
    beforeEach(() => {
        state.executableIds = new Set([
            'visible-device',
            'hidden-device',
            'offline-device'
        ]);
    });

    it('does not add another executable device outside the supplied scope', () => {
        const selection = useDeviceSelection(
            (device) => device.capabilities?.backup === true
        );

        selection.selectAll(['visible-device']);

        expect([...selection.selectedDevices.value]).toEqual(['visible-device']);
        expect(selection.selectedDevices.value.has('hidden-device')).toBe(
            false
        );
    });

    it('still enforces online, permission, and capability checks inside a scope', () => {
        const selection = useDeviceSelection(
            (device) => device.capabilities?.backup === true
        );

        selection.selectAll([
            'visible-device',
            'offline-device',
            'denied-device',
            'unsupported-device'
        ]);

        expect([...selection.selectedDevices.value]).toEqual(['visible-device']);
    });
});
