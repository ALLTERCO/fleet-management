/** REGRESSION: specific failure modes the redesign must not regress on.
 *
 *  Each test names the failure mode and demonstrates the fixed behaviour.
 *  Future changes break these tests if the fix is undone — that's the
 *  point. */

import {createPinia, setActivePinia} from 'pinia';
import {describe, expect, it, vi} from 'vitest';
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
import {buildChildIndex, collectSubtreeIds} from '@/helpers/locationRollups';
import {parseDetailTab, parseSelectedId} from '@/helpers/locationsUrlState';
import type {ApiLocation} from '@/stores/locations';
import {useLocationsStore} from '@/stores/locations';

function loc(id: number, parent: number | null = null): ApiLocation {
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

describe('REGRESSION: cycle in the location tree must not infinite-loop', () => {
    it('a parent referring back to its descendant still terminates', () => {
        // Force a malformed parent index: 2 → 3 → 2 cycle
        const cycleIndex = new Map<number, readonly number[]>();
        cycleIndex.set(1, [2]);
        cycleIndex.set(2, [3]);
        cycleIndex.set(3, [2]);
        const ids = [...collectSubtreeIds(1, cycleIndex)];
        expect(ids.sort()).toEqual([1, 2, 3]);
    });

    it('useLocationRollups returns deterministically with a cycle', () => {
        setActivePinia(createPinia());
        const locations = useLocationsStore();
        // Forge a cycle directly on the store data.
        locations.locations = {
            1: loc(1, null),
            2: loc(2, 1),
            3: loc(3, 2)
        };
        // Re-point 2's parent to 3, creating a cycle.
        locations.locations[2].parentLocationId = 3;
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        // Should produce a finite subtree, not hang.
        expect(rollups.subtreeIds.value.length).toBeGreaterThan(0);
    });
});

describe('REGRESSION: deleted-while-selected — rollups must not throw', () => {
    it('returns zero counts when the selected location vanishes', () => {
        setActivePinia(createPinia());
        const locations = useLocationsStore();
        locations.locations = {1: loc(1)};
        const selectedId = ref<number | null>(1);
        const rollups = useLocationRollups(selectedId);
        expect(rollups.deviceCount.value).toBe(0);
        // Simulate the WS delete event clearing the store entry.
        locations.locations = {};
        expect(rollups.subtreeIds.value).toEqual([1]);
        expect(rollups.deviceCount.value).toBe(0);
    });
});

describe('REGRESSION: refresh-preserves-selection via URL', () => {
    it('parses ?selected=42 back into a usable id after a hard reload', () => {
        // Simulates the browser query string on a refresh.
        expect(parseSelectedId('42')).toBe(42);
        expect(parseDetailTab('plan')).toBe('plan');
    });

    it('falls back gracefully if the URL has garbage from a bookmark', () => {
        expect(parseSelectedId('null')).toBeNull();
        expect(parseDetailTab('summary')).toBe('overview');
    });
});

describe('REGRESSION: empty store does not crash subtree walk', () => {
    it('returns root only when location is unknown but selected', () => {
        const index = buildChildIndex({});
        // Even if the selected id has no entry in the index, the walk
        // returns the root itself — never undefined, never throws.
        expect([...collectSubtreeIds(99, index)]).toEqual([99]);
    });
});

describe('REGRESSION: roots-are-excluded from parent index', () => {
    it('a tree of two roots produces an empty parent index', () => {
        const index = buildChildIndex({
            1: loc(1, null),
            2: loc(2, null)
        });
        expect(index.size).toBe(0);
        // Each root walks to itself.
        expect([...collectSubtreeIds(1, index)]).toEqual([1]);
        expect([...collectSubtreeIds(2, index)]).toEqual([2]);
    });
});
