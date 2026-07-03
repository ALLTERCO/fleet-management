import type {Location as ApiLocation} from '@api/location';
import {describe, expect, it} from 'vitest';
import {__testing} from '@/composables/useLocationStatus';

const {
    isLive,
    statusFromCounts,
    emptyDirectMap,
    bucketDevicesByLocation,
    childrenMap,
    rollupHealth
} = __testing;

describe('isLive', () => {
    it('treats online devices as live', () => {
        expect(isLive({online: true})).toBe(true);
    });
    it('treats sleeping battery devices as live', () => {
        expect(isLive({online: false, sleeping: true})).toBe(true);
    });
    it('treats offline non-sleeping devices as not live', () => {
        expect(isLive({online: false, sleeping: false})).toBe(false);
    });
});

describe('statusFromCounts', () => {
    it('answers unknown when no devices are tracked', () => {
        expect(statusFromCounts({total: 0, online: 0})).toBe('unknown');
    });
    it('answers on when every device is online', () => {
        expect(statusFromCounts({total: 3, online: 3})).toBe('on');
    });
    it('answers off when every device is unreachable', () => {
        expect(statusFromCounts({total: 4, online: 0})).toBe('off');
    });
    it('answers warn when some devices are online and some are not', () => {
        expect(statusFromCounts({total: 5, online: 2})).toBe('warn');
    });
});

describe('emptyDirectMap', () => {
    it('initialises a zeroed counter per location id', () => {
        const map = emptyDirectMap(['1', '2']);
        expect(map.get(1)).toEqual({total: 0, online: 0});
        expect(map.get(2)).toEqual({total: 0, online: 0});
    });
});

describe('bucketDevicesByLocation', () => {
    it('groups device totals into the direct counter for their location', () => {
        const direct = emptyDirectMap(['10']);
        bucketDevicesByLocation(
            [
                {locationId: 10, online: true},
                {locationId: 10, online: false},
                {locationId: 10, online: false, sleeping: true}
            ],
            direct
        );
        expect(direct.get(10)).toEqual({total: 3, online: 2});
    });
    it('ignores devices without a known location', () => {
        const direct = emptyDirectMap(['10']);
        bucketDevicesByLocation(
            [
                {locationId: null, online: true},
                {locationId: 99, online: true}
            ],
            direct
        );
        expect(direct.get(10)).toEqual({total: 0, online: 0});
    });
});

describe('childrenMap', () => {
    it("lists each parent's direct children", () => {
        const map = childrenMap([
            location({id: 1, parentLocationId: null}),
            location({id: 2, parentLocationId: 1}),
            location({id: 3, parentLocationId: 1}),
            location({id: 4, parentLocationId: 2})
        ]);
        expect(map.get(1)?.sort()).toEqual([2, 3]);
        expect(map.get(2)).toEqual([4]);
        expect(map.has(4)).toBe(false);
    });
});

describe('rollupHealth', () => {
    it('rolls direct counts up the parent chain', () => {
        const direct = new Map([
            [1, {total: 0, online: 0}],
            [2, {total: 2, online: 1}],
            [3, {total: 3, online: 3}]
        ]);
        const children = new Map([[1, [2, 3]]]);
        const health = rollupHealth(direct, children);
        expect(health.get(1)).toEqual({total: 5, online: 4, status: 'warn'});
        expect(health.get(2)?.status).toBe('warn');
        expect(health.get(3)?.status).toBe('on');
    });
    it('reports unknown for branches with no devices', () => {
        const direct = new Map([
            [1, {total: 0, online: 0}],
            [2, {total: 0, online: 0}]
        ]);
        const children = new Map([[1, [2]]]);
        expect(rollupHealth(direct, children).get(1)?.status).toBe('unknown');
    });
});

function location(overrides: Partial<ApiLocation>): ApiLocation {
    return {
        id: 1,
        organizationId: 'org-1',
        name: 'L',
        kind: 'site',
        parentLocationId: null,
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
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: null,
        ...overrides
    };
}
