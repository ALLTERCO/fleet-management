/** INTEGRATION: composable wired into the real Pinia stores.
 *
 *  No mocks of the pure helpers — only the WS layer (sendRPC) and the
 *  toast store are stubbed because they cross the network and DOM. The
 *  composable, the rollup helpers, the locations store, and the devices
 *  store are all real. Asserting end-to-end reactivity: mutate a store,
 *  the composable refs follow. */

import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ref} from 'vue';

const {sendRPC, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    sendRPC,
    onLocationEvent: () => () => undefined,
    onAlertEvent: () => () => undefined,
    onAlertInstanceEvent: () => () => undefined,
    onDeviceEvent: () => () => undefined
}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

import {useLocationRollups} from '@/composables/useLocationRollups';
import {useDevicesStore} from '@/stores/devices';
import type {ApiLocation, LocationAssignment} from '@/stores/locations';
import {useLocationsStore} from '@/stores/locations';

function makeLocation(id: number, parent: number | null = null): ApiLocation {
    return {
        id,
        organizationId: 'org',
        name: `loc-${id}`,
        kind: 'site',
        parentLocationId: parent,
        sortOrder: 0,
        kindFields: {},
        customFields: {},
        effective: {
            timezone: null,
            countryCode: null,
            currency: null,
            regulatoryZone: null,
            complianceTags: []
        },
        coordinateStatus: {state: 'missing_address', summary: ''},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

function makeAssignment(
    subjectId: string,
    locationId: number
): LocationAssignment {
    return {
        organizationId: 'org',
        subjectType: 'device',
        subjectId,
        locationId,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

describe('useLocationRollups — integration with real stores', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        toastError.mockReset();
    });

    it('reports zero when selectedId is null', () => {
        const selectedId = ref<number | null>(null);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.deviceCount.value).toBe(0);
        expect(rollups.subtreeIds.value).toEqual([]);
    });

    it('returns the selected node when it has no children', () => {
        const locations = useLocationsStore();
        locations.locations = {1: makeLocation(1)};
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect([...rollups.subtreeIds.value]).toEqual([1]);
        expect(rollups.deviceCount.value).toBe(0);
    });

    it('walks the subtree and counts devices recursively', () => {
        const locations = useLocationsStore();
        locations.locations = {
            1: makeLocation(1, null),
            2: makeLocation(2, 1),
            3: makeLocation(3, 1),
            4: makeLocation(4, 2)
        };
        locations.assignmentsByLocation = {
            2: [makeAssignment('dev-a', 2)],
            3: [makeAssignment('dev-b', 3)],
            4: [makeAssignment('dev-c', 4)]
        };
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.deviceCount.value).toBe(3);
    });

    it('changes deviceCount when selectedId moves to a different subtree', () => {
        const locations = useLocationsStore();
        locations.locations = {
            1: makeLocation(1, null),
            2: makeLocation(2, 1),
            3: makeLocation(3, null)
        };
        locations.assignmentsByLocation = {
            2: [makeAssignment('a', 2), makeAssignment('b', 2)],
            3: [makeAssignment('c', 3)]
        };
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.deviceCount.value).toBe(2);
        selectedId.value = 3;
        expect(rollups.deviceCount.value).toBe(1);
    });

    it('reflects a fresh assignment immediately (reactive store mutation)', () => {
        const locations = useLocationsStore();
        locations.locations = {1: makeLocation(1)};
        locations.assignmentsByLocation = {};
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.deviceCount.value).toBe(0);
        locations.assignmentsByLocation = {1: [makeAssignment('x', 1)]};
        expect(rollups.deviceCount.value).toBe(1);
    });

    it('splits devices into online and offline by the devices store', () => {
        const locations = useLocationsStore();
        const devices = useDevicesStore();
        locations.locations = {1: makeLocation(1)};
        locations.assignmentsByLocation = {
            1: [
                makeAssignment('on-1', 1),
                makeAssignment('on-2', 1),
                makeAssignment('off-1', 1)
            ]
        };
        Object.assign(devices.devices, {
            'on-1': {online: true},
            'on-2': {online: true},
            'off-1': {online: false}
        });
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.onlineSplit.value.online).toBe(2);
        expect(rollups.onlineSplit.value.offline).toBe(1);
    });

    it('treats devices missing from the store as offline (safer default)', () => {
        const locations = useLocationsStore();
        locations.locations = {1: makeLocation(1)};
        locations.assignmentsByLocation = {
            1: [makeAssignment('ghost', 1)]
        };
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.onlineSplit.value.offline).toBe(1);
        expect(rollups.onlineSplit.value.online).toBe(0);
    });
});
