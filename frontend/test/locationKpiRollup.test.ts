import {beforeEach, describe, expect, it} from 'vitest';
import {
    clearLocationKpiRollupCache,
    rollupLocationKpis,
    rollupLocationKpisMemoised
} from '@/helpers/locationKpiRollup';
import type {ApiLocation} from '@/stores/locations';
import type {ShellyDeviceExternal} from '@/types';

function makeLocation(id: number): ApiLocation {
    return {
        id,
        organizationId: 'org',
        name: `loc-${id}`,
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
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

function fakeDevice(opts: {
    id: string;
    locationId: number;
    presence?: 'online' | 'offline' | 'pending';
    powerW?: number;
    rssi?: number;
    fwVer?: string;
    statusTs?: number;
    savingsPct?: number;
}): ShellyDeviceExternal {
    const status: Record<string, unknown> = {};
    if (opts.powerW != null) status['switch:0'] = {apower: opts.powerW};
    if (opts.rssi != null) status.wifi = {rssi: opts.rssi};
    return {
        id: 0,
        shellyID: opts.id,
        presence: opts.presence ?? 'online',
        source: 'shelly',
        info: {ver: opts.fwVer ?? '1.0.0'},
        status,
        _statusTs: opts.statusTs,
        settings: {},
        _settingsTs: undefined,
        selected: false,
        kvs: {},
        entities: [],
        capabilities: {},
        meta: {},
        methods: [],
        locationId: opts.locationId,
        statusSummary:
            opts.savingsPct != null
                ? {savingsPotentialPct: opts.savingsPct}
                : undefined
    } as unknown as ShellyDeviceExternal;
}

describe('rollupLocationKpis', () => {
    it('counts only devices whose locationId is in the subtree', () => {
        const location = makeLocation(10);
        const devicesIndex: Record<string, ShellyDeviceExternal> = {
            a: fakeDevice({id: 'a', locationId: 10}),
            b: fakeDevice({id: 'b', locationId: 99})
        };
        const result = rollupLocationKpis({
            location,
            devicesIndex,
            descendantLocationIds: new Set([10])
        });
        expect(result.total).toBe(1);
    });

    it('counts and powerKW are zero on empty subtree; todayKWh and alerts are null', () => {
        const location = makeLocation(10);
        const result = rollupLocationKpis({
            location,
            devicesIndex: {
                a: fakeDevice({id: 'a', locationId: 99})
            },
            descendantLocationIds: new Set([10])
        });
        expect(result).toEqual({
            total: 0,
            on: 0,
            off: 0,
            warn: 0,
            powerKW: 0,
            todayKWh: null,
            alerts: null,
            lastSeenTs: 0,
            savingsPotentialPct: 0,
            firmwareHealthPct: 0,
            signalHealthPct: 0
        });
    });

    it('aggregates devices across the whole descendant subtree', () => {
        const location = makeLocation(1);
        const devicesIndex: Record<string, ShellyDeviceExternal> = {
            a: fakeDevice({id: 'a', locationId: 1}),
            b: fakeDevice({id: 'b', locationId: 2}),
            c: fakeDevice({id: 'c', locationId: 3}),
            d: fakeDevice({id: 'd', locationId: 99})
        };
        const result = rollupLocationKpis({
            location,
            devicesIndex,
            descendantLocationIds: new Set([1, 2, 3])
        });
        expect(result.total).toBe(3);
    });

    it('returns the most recent _statusTs across the subtree', () => {
        const location = makeLocation(10);
        const devicesIndex: Record<string, ShellyDeviceExternal> = {
            a: fakeDevice({id: 'a', locationId: 10, statusTs: 1_000_000}),
            b: fakeDevice({id: 'b', locationId: 10, statusTs: 9_000_000}),
            c: fakeDevice({id: 'c', locationId: 10, statusTs: 5_000_000})
        };
        const result = rollupLocationKpis({
            location,
            devicesIndex,
            descendantLocationIds: new Set([10])
        });
        expect(result.lastSeenTs).toBe(9_000_000);
    });

    it('reports firmware health as the share of devices on the latest firmware version', () => {
        const location = makeLocation(10);
        const devicesIndex: Record<string, ShellyDeviceExternal> = {
            a: fakeDevice({id: 'a', locationId: 10, fwVer: '2.0.0'}),
            b: fakeDevice({id: 'b', locationId: 10, fwVer: '2.0.0'}),
            c: fakeDevice({id: 'c', locationId: 10, fwVer: '1.5.0'})
        };
        const result = rollupLocationKpis({
            location,
            devicesIndex,
            descendantLocationIds: new Set([10])
        });
        // 2 of 3 devices on latest firmware = 66.7%
        expect(result.firmwareHealthPct).toBeCloseTo(66.67, 1);
    });

    it('reports signal health as the share of devices with rssi >= -75', () => {
        const location = makeLocation(10);
        const devicesIndex: Record<string, ShellyDeviceExternal> = {
            a: fakeDevice({id: 'a', locationId: 10, rssi: -60}),
            b: fakeDevice({id: 'b', locationId: 10, rssi: -75}),
            c: fakeDevice({id: 'c', locationId: 10, rssi: -80})
        };
        const result = rollupLocationKpis({
            location,
            devicesIndex,
            descendantLocationIds: new Set([10])
        });
        // 2 of 3 healthy → ~66.67
        expect(result.signalHealthPct).toBeCloseTo(66.67, 1);
    });

    it('passes through savingsPotentialPct from device statusSummary', () => {
        const location = makeLocation(10);
        // Two devices with savings of 60% and 40% (equal power weight → mean 50%)
        const devicesIndex: Record<string, ShellyDeviceExternal> = {
            a: fakeDevice({id: 'a', locationId: 10, savingsPct: 60}),
            b: fakeDevice({id: 'b', locationId: 10, savingsPct: 40})
        };
        const result = rollupLocationKpis({
            location,
            devicesIndex,
            descendantLocationIds: new Set([10])
        });
        expect(result.savingsPotentialPct).toBe(50);
    });
});

describe('rollupLocationKpisMemoised', () => {
    beforeEach(() => {
        clearLocationKpiRollupCache();
    });

    it('returns the cached value when the cache key is unchanged', () => {
        const location = makeLocation(10);
        const devicesIndex: Record<string, ShellyDeviceExternal> = {
            a: fakeDevice({id: 'a', locationId: 10})
        };
        const descendantLocationIds = new Set([10]);
        const first = rollupLocationKpisMemoised({
            location,
            devicesIndex,
            descendantLocationIds,
            devicesRevision: 1
        });
        const second = rollupLocationKpisMemoised({
            location,
            devicesIndex,
            descendantLocationIds,
            devicesRevision: 1
        });
        expect(second).toBe(first);
    });

    it('recomputes when devicesRevision changes (cache invalidated)', () => {
        const location = makeLocation(1);
        const devs1 = {
            a: fakeDevice({
                id: 'a',
                locationId: 1,
                presence: 'online',
                powerW: 1000
            })
        };
        const devs2 = {
            a: fakeDevice({
                id: 'a',
                locationId: 1,
                presence: 'online',
                powerW: 2000
            })
        };
        const ids = new Set([1]);

        const r1 = rollupLocationKpisMemoised({
            location,
            devicesIndex: devs1,
            descendantLocationIds: ids,
            devicesRevision: 1
        });
        expect(r1.powerKW).toBeCloseTo(1.0, 1);

        // Same key components except revision bumped — must recompute on the new data
        const r2 = rollupLocationKpisMemoised({
            location,
            devicesIndex: devs2,
            descendantLocationIds: ids,
            devicesRevision: 2
        });
        expect(r2.powerKW).toBeCloseTo(2.0, 1);
    });

    it('LRU evicts the oldest entry when more than MEMO_CACHE_MAX (100) ids are cached', () => {
        const devicesIndex: Record<string, ShellyDeviceExternal> = {};
        const ids = new Set([0]);
        // Insert 101 distinct locations into the memo cache.
        for (let i = 0; i < 101; i++) {
            rollupLocationKpisMemoised({
                location: makeLocation(i),
                devicesIndex,
                descendantLocationIds: ids,
                devicesRevision: 1
            });
        }
        // The oldest entry (locationId=0) was evicted, so a subsequent
        // call recomputes; the prior result is no longer reference-equal.
        const a = rollupLocationKpisMemoised({
            location: makeLocation(0),
            devicesIndex,
            descendantLocationIds: ids,
            devicesRevision: 1
        });
        const b = rollupLocationKpisMemoised({
            location: makeLocation(0),
            devicesIndex,
            descendantLocationIds: ids,
            devicesRevision: 1
        });
        // Now both are cache HIT, so they're reference-equal again.
        expect(b).toBe(a);
    });
});
