/** SYSTEM: end-to-end behavioural contract for the locations redesign.
 *
 *  Exercises the full chain a real user invocation goes through:
 *  URL parse → store hydrate → composable subtree walk → rollup count.
 *
 *  Stays at the module level — no component mount. The component layer
 *  is a thin reactive shell over the units this test covers; if the
 *  units agree, the component will too. */

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
import {resolveActiveTab, visibleKpisForKind} from '@/helpers/location-kinds';
import {parseDetailTab, parseSelectedId} from '@/helpers/locationsUrlState';
import {useDevicesStore} from '@/stores/devices';
import type {
    ApiLocation,
    LocationAssignment,
    LocationKind
} from '@/stores/locations';
import {useLocationsStore} from '@/stores/locations';

function loc(
    id: number,
    parent: number | null = null,
    kind: LocationKind = 'building'
): ApiLocation {
    return {
        id,
        organizationId: 'org',
        name: `loc-${id}`,
        kind,
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

function assignment(subjectId: string, locationId: number): LocationAssignment {
    return {
        organizationId: 'org',
        subjectType: 'device',
        subjectId,
        locationId,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

describe('SYSTEM: full URL → store → rollups path', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
    });

    it('deep-link → selected node → KPIs reflect subtree', () => {
        // Simulates URL `/organize/locations?selected=2&tab=plan`
        const urlSelected = '2';
        const urlTab = 'plan';
        const selectedId = ref(parseSelectedId(urlSelected));
        const activeTab = parseDetailTab(urlTab);

        expect(selectedId.value).toBe(2);
        expect(activeTab).toBe('plan');

        // Store hydrates after page mount.
        const locations = useLocationsStore();
        const devices = useDevicesStore();
        locations.locations = {
            1: loc(1, null),
            2: loc(2, 1),
            3: loc(3, 2),
            4: loc(4, 2)
        };
        locations.assignmentsByLocation = {
            3: [assignment('d1', 3), assignment('d2', 3)],
            4: [assignment('d3', 4)]
        };
        Object.assign(devices.devices, {
            d1: {online: true},
            d2: {online: true},
            d3: {online: false}
        });

        const rollups = useLocationRollups(selectedId);
        // Subtree of 2 is {2,3,4}; devices d1+d2 at 3, d3 at 4 → 3 total.
        expect(rollups.deviceCount.value).toBe(3);
        expect(rollups.onlineSplit.value.online).toBe(2);
        expect(rollups.onlineSplit.value.offline).toBe(1);
    });

    it('clicking a sibling in the tree updates KPIs without remount', () => {
        const locations = useLocationsStore();
        locations.locations = {
            1: loc(1, null),
            2: loc(2, 1),
            3: loc(3, 1)
        };
        locations.assignmentsByLocation = {
            2: [assignment('a', 2), assignment('b', 2), assignment('c', 2)],
            3: [assignment('d', 3)]
        };

        const selectedId = ref<number | null>(2);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.deviceCount.value).toBe(3);
        // User clicks sibling — same composable, new id.
        selectedId.value = 3;
        expect(rollups.deviceCount.value).toBe(1);
    });

    it('creating a child invalidates parent rollups via store reactivity', () => {
        const locations = useLocationsStore();
        locations.locations = {1: loc(1)};
        locations.assignmentsByLocation = {};
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.subtreeIds.value).toEqual([1]);

        // Inline-create added child 2 under 1.
        locations.locations = {
            ...locations.locations,
            2: loc(2, 1)
        };
        // Subtree now includes the new child.
        const ids = [...rollups.subtreeIds.value].sort();
        expect(ids).toEqual([1, 2]);
    });
});

describe('SYSTEM: kind drives default tab + KPI visibility end-to-end', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
    });

    it('selecting a country lands on overview with geographic KPIs', () => {
        const locations = useLocationsStore();
        locations.locations = {1: loc(1, null, 'country')};

        const selectedId = ref<number | null>(parseSelectedId('1'));
        const selectedKind = locations.locations[selectedId.value ?? -1]?.kind;
        const activeTab = resolveActiveTab(undefined, selectedKind);
        const visibleKpis = visibleKpisForKind(selectedKind);

        expect(activeTab).toBe('overview');
        expect(visibleKpis.has('power')).toBe(false);
        expect(visibleKpis.has('temperature')).toBe(false);
    });

    it('selecting a building lands on plan with the full indoor KPI set', () => {
        const locations = useLocationsStore();
        locations.locations = {7: loc(7, null, 'building')};

        const selectedId = ref<number | null>(parseSelectedId('7'));
        const selectedKind = locations.locations[selectedId.value ?? -1]?.kind;
        const activeTab = resolveActiveTab(undefined, selectedKind);
        const visibleKpis = visibleKpisForKind(selectedKind);

        expect(activeTab).toBe('plan');
        expect(visibleKpis.has('temperature')).toBe(true);
        expect(visibleKpis.has('power')).toBe(true);
    });

    it('explicit URL tab overrides the kind default', () => {
        const locations = useLocationsStore();
        locations.locations = {3: loc(3, null, 'building')};

        const selectedKind = locations.locations[3]?.kind;
        // User typed ?tab=settings — kind would say "plan" but URL wins.
        expect(resolveActiveTab('settings', selectedKind)).toBe('settings');
    });

    it('switching the selected kind reruns both tab and KPI visibility', () => {
        const locations = useLocationsStore();
        locations.locations = {
            1: loc(1, null, 'country'),
            2: loc(2, 1, 'zone')
        };

        const selectedId = ref<number | null>(1);
        const tabAtCountry = resolveActiveTab(
            undefined,
            locations.locations[selectedId.value ?? -1]?.kind
        );
        expect(tabAtCountry).toBe('overview');

        selectedId.value = 2;
        const tabAtZone = resolveActiveTab(
            undefined,
            locations.locations[selectedId.value ?? -1]?.kind
        );
        expect(tabAtZone).toBe('plan');

        const kpisAtZone = visibleKpisForKind(
            locations.locations[selectedId.value ?? -1]?.kind
        );
        expect(kpisAtZone.has('temperature')).toBe(true);
    });
});
