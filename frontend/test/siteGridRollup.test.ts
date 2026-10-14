import {describe, expect, it} from 'vitest';
import {
    rollupSiteGridDevices,
    type SiteGridDevice
} from '@/helpers/siteGridRollup';
import type {ApiLocation} from '@/stores/locations';

function location(
    id: number,
    kind: ApiLocation['kind'],
    parentLocationId: number | null,
    counts?: ApiLocation['counts']
): ApiLocation {
    return {
        id,
        organizationId: 'org-fixture',
        name: `Location ${id}`,
        kind,
        parentLocationId,
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
        updatedAt: null,
        counts
    };
}

function device(
    locationId: number | null | undefined,
    online: boolean,
    powerW: number
): SiteGridDevice {
    return {
        locationId,
        online,
        status: {'switch:0': {apower: powerW}}
    } as SiteGridDevice;
}

describe('rollupSiteGridDevices', () => {
    it('aggregates direct and descendant devices despite a zeroed partial location summary', () => {
        const locations: Record<number, ApiLocation> = {
            10: location(10, 'site', null, {
                childLocations: 1,
                devices: 0,
                descendantDevices: 0
            }),
            20: location(20, 'building', 10),
            30: location(30, 'room', 20),
            40: location(40, 'site', null)
        };
        const devices: Record<string, SiteGridDevice> = {
            'direct-device': device(10, true, 10),
            'building-device': device(20, false, 20),
            'room-device': device(30, true, 30),
            'other-site-device': device(40, true, 900),
            'unknown-location-device': device(999, true, 800),
            'unassigned-device': device(null, true, 700)
        };

        expect(rollupSiteGridDevices(devices, locations, 10)).toEqual({
            deviceIds: ['building-device', 'direct-device', 'room-device'],
            totalCount: 3,
            onlineCount: 2,
            powerW: 60
        });
    });

    it('fails closed when the requested root is not in the loaded hierarchy', () => {
        const locations: Record<number, ApiLocation> = {
            10: location(10, 'site', null)
        };
        const devices: Record<string, SiteGridDevice> = {
            'unknown-location-device': device(999, true, 100)
        };

        expect(rollupSiteGridDevices(devices, locations, 999)).toEqual({
            deviceIds: [],
            totalCount: 0,
            onlineCount: 0,
            powerW: 0
        });
    });
});
