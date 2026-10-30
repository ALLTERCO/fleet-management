import {describe, expect, it} from 'vitest';
import {
    rollupLocationKpis,
    type RollupDevice
} from '@/helpers/locationKpiRollup';
import type {ApiLocation} from '@/stores/locations';

function location(id: number): ApiLocation {
    return {
        id,
        organizationId: 'org-fixture',
        name: `Location ${id}`,
        kind: 'site',
        parentLocationId: null,
        sortOrder: id,
        kindFields: {},
        customFields: {},
        effective: {
            timezone: null,
            countryCode: null,
            currency: null,
            regulatoryZone: null,
            complianceTags: []
        },
        coordinateStatus: {state: 'missing_address', summary: 'Fixture'},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: null
    };
}

function storeDevice(input: {
    id: number;
    locationId: number;
    online: boolean;
    unixtime: number;
}): RollupDevice {
    return {
        id: input.id,
        locationId: input.locationId,
        online: input.online,
        info: {ver: '1.2.3'},
        status: {
            sys: {unixtime: input.unixtime},
            wifi: {rssi: -60},
            'switch:0': {apower: 25}
        }
    };
}

describe('location KPI rollup', () => {
    it('counts the canonical store online state without raw presence metadata', () => {
        const site = location(10);
        const device = storeDevice({
            id: 1,
            locationId: site.id,
            online: true,
            unixtime: 1_800_000_000
        });

        expect('presence' in device).toBe(false);
        expect('_statusTs' in device).toBe(false);

        expect(
            rollupLocationKpis({
                location: site,
                devicesIndex: {onlineDevice: device},
                descendantLocationIds: new Set([site.id])
            })
        ).toMatchObject({
            total: 1,
            on: 1,
            off: 0,
            warn: 0,
            powerKW: 0.025,
            lastSeenTs: 1_800_000_000_000
        });
    });

    it('still classifies an offline store row as offline', () => {
        const site = location(20);
        const device = storeDevice({
            id: 2,
            locationId: site.id,
            online: false,
            unixtime: 1_800_000_100
        });

        expect(
            rollupLocationKpis({
                location: site,
                devicesIndex: {offlineDevice: device},
                descendantLocationIds: new Set([site.id])
            })
        ).toMatchObject({
            total: 1,
            on: 0,
            off: 1,
            warn: 0,
            lastSeenTs: 1_800_000_100_000
        });
    });
});
