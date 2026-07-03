import {describe, expect, it} from 'vitest';
import {
    type AlertForRollup,
    buildChildIndex,
    collectAssignedDevices,
    collectSubtreeIds,
    countDeviceAlerts,
    countOnlineSplit,
    type DeviceForRollup,
    sumDevicePower,
    summarizeDeviceTemperature
} from '@/helpers/locationRollups';
import type {ApiLocation, LocationAssignment} from '@/stores/locations';

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
    locationId: number,
    subjectType: 'device' | 'entity' = 'device'
): LocationAssignment {
    return {
        organizationId: 'org',
        subjectType,
        subjectId,
        locationId,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

describe('buildChildIndex', () => {
    it('returns an empty map when no locations exist', () => {
        expect(buildChildIndex({}).size).toBe(0);
    });

    it('groups children under their parent', () => {
        const index = buildChildIndex({
            1: makeLocation(1, null),
            2: makeLocation(2, 1),
            3: makeLocation(3, 1),
            4: makeLocation(4, 2)
        });
        expect(index.get(1)).toEqual([2, 3]);
        expect(index.get(2)).toEqual([4]);
        expect(index.has(3)).toBe(false);
    });

    it('omits root locations from the parent index', () => {
        const index = buildChildIndex({
            1: makeLocation(1, null),
            2: makeLocation(2, null)
        });
        expect(index.size).toBe(0);
    });
});

describe('collectSubtreeIds', () => {
    it('returns the root itself when it has no children', () => {
        const index = buildChildIndex({1: makeLocation(1)});
        expect(collectSubtreeIds(1, index)).toEqual([1]);
    });

    it('collects every descendant of the root', () => {
        const index = buildChildIndex({
            1: makeLocation(1, null),
            2: makeLocation(2, 1),
            3: makeLocation(3, 1),
            4: makeLocation(4, 2)
        });
        const ids = [...collectSubtreeIds(1, index)].sort();
        expect(ids).toEqual([1, 2, 3, 4]);
    });

    it('does not infinite-loop on a malformed cycle', () => {
        const cycle = new Map<number, readonly number[]>();
        cycle.set(1, [2]);
        cycle.set(2, [3]);
        cycle.set(3, [2]);
        const ids = [...collectSubtreeIds(1, cycle)].sort();
        expect(ids).toEqual([1, 2, 3]);
    });
});

describe('collectAssignedDevices', () => {
    it('returns an empty list when no assignments exist', () => {
        expect(collectAssignedDevices([1, 2], {})).toEqual([]);
    });

    it('returns device subject IDs and skips entity subjects', () => {
        const devices = collectAssignedDevices([1, 2], {
            1: [makeAssignment('a', 1), makeAssignment('b', 1, 'entity')],
            2: [makeAssignment('c', 2)]
        });
        expect(devices).toEqual(['a', 'c']);
    });

    it('aggregates assignments across all listed locations', () => {
        const devices = collectAssignedDevices([1, 2, 3], {
            1: [makeAssignment('a', 1)],
            2: [makeAssignment('b', 2)],
            3: [makeAssignment('c', 3)]
        });
        expect(devices).toEqual(['a', 'b', 'c']);
    });
});

describe('countOnlineSplit', () => {
    it('returns zero counts for an empty device list', () => {
        expect(countOnlineSplit([], {})).toEqual({
            online: 0,
            offline: 0,
            warning: 0
        });
    });

    it('counts online and offline by the lookup map', () => {
        const split = countOnlineSplit(['a', 'b', 'c'], {
            a: true,
            b: false,
            c: true
        });
        expect(split).toEqual({online: 2, offline: 1, warning: 0});
    });

    it('treats unknown device IDs as offline', () => {
        const split = countOnlineSplit(['ghost'], {});
        expect(split.online).toBe(0);
        expect(split.offline).toBe(1);
    });
});

function alert(
    subjectId: string,
    state: AlertForRollup['state'],
    subjectType = 'device'
): AlertForRollup {
    return {state, source: {subjectType, subjectId}};
}

describe('countDeviceAlerts', () => {
    it('returns 0 when no alerts target a subtree device', () => {
        const count = countDeviceAlerts(
            ['a', 'b'],
            [alert('other', 'active'), alert('not-in-subtree', 'active')]
        );
        expect(count).toBe(0);
    });

    it('counts every non-terminal alert lifecycle state', () => {
        const count = countDeviceAlerts(
            ['a', 'b'],
            [
                alert('a', 'pending'),
                alert('a', 'active'),
                alert('a', 'acknowledged'),
                alert('a', 'recovering'),
                alert('a', 'cleared_unack'),
                alert('b', 'no_data'),
                alert('b', 'evaluation_error')
            ]
        );
        expect(count).toBe(7);
    });

    it('does not count terminal closed alert states', () => {
        const count = countDeviceAlerts(
            ['a', 'b'],
            [
                alert('a', 'resolved'),
                alert('b', 'cleared_ack'),
                alert('b', 'active')
            ]
        );
        expect(count).toBe(1);
    });

    it('ignores non-device source subjects (groups, locations, tags)', () => {
        const count = countDeviceAlerts(
            ['a'],
            [
                alert('a', 'active', 'group'),
                alert('a', 'active', 'location'),
                alert('a', 'active', 'device')
            ]
        );
        expect(count).toBe(1);
    });
});

function statusOnly(status: Record<string, unknown>): DeviceForRollup {
    return {status};
}

describe('sumDevicePower', () => {
    it('returns null when no metering surfaces exist (KPI strip hides metric)', () => {
        const result = sumDevicePower(['a'], {
            a: statusOnly({'temperature:0': {tC: 21}})
        });
        expect(result).toBeNull();
    });

    it('sums apower across multiple components on the same device', () => {
        const result = sumDevicePower(['a'], {
            a: statusOnly({
                'switch:0': {apower: 50},
                'switch:1': {apower: 25}
            })
        });
        expect(result).toBe(75);
    });

    it('treats act_power (3EM / EM3) like apower', () => {
        const result = sumDevicePower(['a'], {
            a: statusOnly({
                'em:0': {act_power: 1234}
            })
        });
        expect(result).toBe(1234);
    });

    it('skips non-numeric and non-finite values without crashing', () => {
        const result = sumDevicePower(['a'], {
            a: statusOnly({
                'switch:0': {apower: 50},
                'switch:1': {apower: Number.NaN},
                'switch:2': {apower: 'oops'}
            })
        });
        expect(result).toBe(50);
    });

    it('aggregates across multiple devices in the subtree', () => {
        const result = sumDevicePower(['a', 'b'], {
            a: statusOnly({'switch:0': {apower: 10}}),
            b: statusOnly({'pm1:0': {apower: 20}})
        });
        expect(result).toBe(30);
    });
});

describe('summarizeDeviceTemperature', () => {
    it('returns null when no device exposes a tC reading', () => {
        const result = summarizeDeviceTemperature(['a'], {
            a: statusOnly({'switch:0': {apower: 50}})
        });
        expect(result).toBeNull();
    });

    it('reports min, avg, and max across the subtree', () => {
        const result = summarizeDeviceTemperature(['a', 'b', 'c'], {
            a: statusOnly({'temperature:0': {tC: 18}}),
            b: statusOnly({'temperature:0': {tC: 22}}),
            c: statusOnly({'temperature:0': {tC: 26}})
        });
        expect(result).toEqual({
            minCelsius: 18,
            avgCelsius: 22,
            maxCelsius: 26
        });
    });

    it('rolls up multiple temperature components on the same device', () => {
        const result = summarizeDeviceTemperature(['a'], {
            a: statusOnly({
                'temperature:0': {tC: 20},
                'temperature:1': {tC: 24}
            })
        });
        expect(result?.minCelsius).toBe(20);
        expect(result?.maxCelsius).toBe(24);
        expect(result?.avgCelsius).toBe(22);
    });

    it('ignores non-numeric readings without skewing min/max', () => {
        const result = summarizeDeviceTemperature(['a'], {
            a: statusOnly({
                'temperature:0': {tC: 20},
                'temperature:1': {tC: 'bad'}
            })
        });
        expect(result?.minCelsius).toBe(20);
        expect(result?.maxCelsius).toBe(20);
    });
});
