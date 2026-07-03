import type {Location as ApiLocation} from '@api/location';
import {computed} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';

export type LocationStatus = 'on' | 'warn' | 'off' | 'unknown';

export interface LocationHealth {
    total: number;
    online: number;
    status: LocationStatus;
}

interface DeviceLike {
    locationId?: number | null;
    online?: boolean;
    sleeping?: boolean;
}

interface DirectCount {
    total: number;
    online: number;
}

// Sleeping battery devices are expected-offline, not unhealthy.
function isLive(device: DeviceLike): boolean {
    return device.online === true || device.sleeping === true;
}

function statusFromCounts(counts: DirectCount): LocationStatus {
    if (counts.total === 0) return 'unknown';
    if (counts.online === counts.total) return 'on';
    if (counts.online === 0) return 'off';
    return 'warn';
}

function emptyDirectMap(
    locationIds: Iterable<string>
): Map<number, DirectCount> {
    const direct = new Map<number, DirectCount>();
    for (const id of locationIds) direct.set(Number(id), {total: 0, online: 0});
    return direct;
}

function bucketDevicesByLocation(
    devices: Iterable<DeviceLike>,
    direct: Map<number, DirectCount>
): Map<number, DirectCount> {
    for (const device of devices) {
        const locId = device.locationId;
        if (locId == null) continue;
        const bucket = direct.get(locId);
        if (!bucket) continue;
        bucket.total++;
        if (isLive(device)) bucket.online++;
    }
    return direct;
}

function childrenMap(locations: ApiLocation[]): Map<number, number[]> {
    const children = new Map<number, number[]>();
    for (const loc of locations) {
        const parent = loc.parentLocationId;
        if (parent == null) continue;
        const list = children.get(parent) ?? [];
        list.push(loc.id);
        children.set(parent, list);
    }
    return children;
}

function rollupHealth(
    direct: Map<number, DirectCount>,
    children: Map<number, number[]>
): Map<number, LocationHealth> {
    const memo = new Map<number, LocationHealth>();
    function visit(id: number): LocationHealth {
        const cached = memo.get(id);
        if (cached) return cached;
        const self = direct.get(id) ?? {total: 0, online: 0};
        const totals: DirectCount = {total: self.total, online: self.online};
        for (const childId of children.get(id) ?? []) {
            const sub = visit(childId);
            totals.total += sub.total;
            totals.online += sub.online;
        }
        const health: LocationHealth = {
            total: totals.total,
            online: totals.online,
            status: statusFromCounts(totals)
        };
        memo.set(id, health);
        return health;
    }
    for (const id of direct.keys()) visit(id);
    return memo;
}

// Test-only export — callers use useLocationStatus().
export const __testing = {
    isLive,
    statusFromCounts,
    emptyDirectMap,
    bucketDevicesByLocation,
    childrenMap,
    rollupHealth
};

export function useLocationStatus() {
    const locationsStore = useLocationsStore();
    const devicesStore = useDevicesStore();

    const health = computed<Map<number, LocationHealth>>(() => {
        void devicesStore.devicesVersion; // recompute on device state changes

        const allLocations = Object.values(
            locationsStore.locations
        ) as ApiLocation[];
        const direct = bucketDevicesByLocation(
            Object.values(devicesStore.devices),
            emptyDirectMap(Object.keys(locationsStore.locations))
        );
        return rollupHealth(direct, childrenMap(allLocations));
    });

    return {health};
}
