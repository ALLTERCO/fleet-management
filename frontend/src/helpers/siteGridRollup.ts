import {collectDescendants} from '@/helpers/locationTree';
import {extractDevicePower} from '@/stores/energyDashboard';
import type {ApiLocation} from '@/stores/locations';
import type {shelly_device_t} from '@/types';

export type SiteGridDevice = Pick<
    shelly_device_t,
    'locationId' | 'online' | 'status'
>;

export interface SiteGridDeviceRollup {
    deviceIds: string[];
    totalCount: number;
    onlineCount: number;
    powerW: number;
}

const EMPTY_ROLLUP: SiteGridDeviceRollup = Object.freeze({
    deviceIds: [],
    totalCount: 0,
    onlineCount: 0,
    powerW: 0
});

/**
 * Roll up the devices already returned by Device.List for one location tree.
 *
 * Location.List summaries are intentionally not used here: a partial summary
 * must never turn unknown descendant counts into a confident zero. Devices at
 * locations outside the currently known subtree are excluded, so an incomplete
 * hierarchy fails closed instead of leaking devices from another site.
 */
export function rollupSiteGridDevices(
    devices: Readonly<Record<string, SiteGridDevice>>,
    locations: Readonly<Record<number, ApiLocation>>,
    rootLocationId: number
): SiteGridDeviceRollup {
    if (!Number.isInteger(rootLocationId) || rootLocationId <= 0) {
        return EMPTY_ROLLUP;
    }
    if (!locations[rootLocationId]) return EMPTY_ROLLUP;

    const scopedLocationIds = collectDescendants(rootLocationId, locations);
    scopedLocationIds.add(rootLocationId);

    const deviceIds: string[] = [];
    let onlineCount = 0;
    let powerW = 0;

    for (const [shellyId, device] of Object.entries(devices)) {
        const locationId = device.locationId;
        if (
            typeof locationId !== 'number' ||
            !Number.isInteger(locationId) ||
            !scopedLocationIds.has(locationId)
        ) {
            continue;
        }
        deviceIds.push(shellyId);
        if (device.online) onlineCount += 1;
        powerW += extractDevicePower(device.status);
    }

    deviceIds.sort();
    return {
        deviceIds,
        totalCount: deviceIds.length,
        onlineCount,
        powerW
    };
}
