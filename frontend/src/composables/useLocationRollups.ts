/** Reactive rollup metrics for the currently-selected location and all its
 *  descendants. Wires the pure helpers in `helpers/locationRollups.ts` to
 *  the Pinia stores so every metric refreshes when the underlying data
 *  changes (device online flag flips, new assignment, location moved). */

import {computed, type Ref} from 'vue';
import {
    buildChildIndex,
    collectAssignedDevices,
    collectSubtreeIds,
    countDeviceAlerts,
    countOnlineSplit,
    type OnlineSplit,
    sumDevicePower,
    summarizeDeviceTemperature,
    type TemperatureSummaryC
} from '@/helpers/locationRollups';
import {useAlertsStore} from '@/stores/alerts';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';

export type TemperatureSummary = TemperatureSummaryC;

export interface LocationRollups {
    readonly subtreeIds: Readonly<Ref<readonly number[]>>;
    readonly deviceCount: Readonly<Ref<number>>;
    readonly onlineSplit: Readonly<Ref<OnlineSplit>>;
    readonly alertCount: Readonly<Ref<number>>;
    readonly powerSumWatts: Readonly<Ref<number | null>>;
    readonly temperature: Readonly<Ref<TemperatureSummary | null>>;
}

export function useLocationRollups(
    selectedId: Readonly<Ref<number | null>>
): LocationRollups {
    const locations = useLocationsStore();
    const devices = useDevicesStore();
    const alerts = useAlertsStore();

    const childIndex = computed(() => buildChildIndex(locations.locations));

    const subtreeIds = computed<readonly number[]>(() => {
        const id = selectedId.value;
        if (id == null) return [];
        return collectSubtreeIds(id, childIndex.value);
    });

    const deviceIds = computed<readonly string[]>(() =>
        collectAssignedDevices(
            subtreeIds.value,
            locations.assignmentsByLocation
        )
    );

    const deviceCount = computed(() => deviceIds.value.length);

    const onlineSplit = computed<OnlineSplit>(() =>
        countOnlineSplit(deviceIds.value, deviceOnlineMap(devices.devices))
    );

    const alertCount = computed(() =>
        countDeviceAlerts(deviceIds.value, Object.values(alerts.instances))
    );

    const powerSumWatts = computed<number | null>(() =>
        sumDevicePower(deviceIds.value, devices.devices)
    );

    const temperature = computed<TemperatureSummary | null>(() =>
        summarizeDeviceTemperature(deviceIds.value, devices.devices)
    );

    return {
        subtreeIds,
        deviceCount,
        onlineSplit,
        alertCount,
        powerSumWatts,
        temperature
    };
}

function deviceOnlineMap(
    devices: Readonly<Record<string, {online?: boolean}>>
): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const [id, device] of Object.entries(devices)) {
        map[id] = device?.online === true;
    }
    return map;
}
