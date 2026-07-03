/** Build per-child OverviewChild rows for a parent location.
 *  Walks each child's subtree to count assigned devices + open alerts.
 *  Pure-reactive — re-derives whenever the store data changes. */

import {computed, type Ref} from 'vue';
import type {OverviewChild} from '@/components/locations/overview/OverviewChildGrid.vue';
import {kindDotColor} from '@/helpers/location-kinds';
import {
    buildChildIndex,
    collectAssignedDevices,
    collectSubtreeIds,
    countDeviceAlerts
} from '@/helpers/locationRollups';
import {useAlertsStore} from '@/stores/alerts';
import {type ApiLocation, useLocationsStore} from '@/stores/locations';

export function useChildOverview(
    parentId: Readonly<Ref<number | null>>
): Readonly<Ref<readonly OverviewChild[]>> {
    const locations = useLocationsStore();
    const alerts = useAlertsStore();

    const childIndex = computed(() => buildChildIndex(locations.locations));

    return computed(() => {
        const id = parentId.value;
        if (id == null) return [];
        const childIds = childIndex.value.get(id);
        if (!childIds || childIds.length === 0) return [];
        const alertList = Object.values(alerts.instances);
        return [...childIds]
            .map((cid) => locations.locations[cid])
            .filter((c): c is ApiLocation => !!c)
            .map((child) =>
                buildChildRow({child, index: childIndex.value, alertList})
            );
    });

    function buildChildRow(input: {
        readonly child: ApiLocation;
        readonly index: ReturnType<typeof buildChildIndex>;
        readonly alertList: Parameters<typeof countDeviceAlerts>[1];
    }): OverviewChild {
        const {child, index, alertList} = input;
        const subtree = collectSubtreeIds(child.id, index);
        const deviceIds = collectAssignedDevices(
            subtree,
            locations.assignmentsByLocation
        );
        return {
            id: child.id,
            name: child.name,
            kindLabel: locations.kindLabel(child.kind),
            dotColor: kindDotColor(child.kind),
            deviceCount: deviceIds.length,
            alertCount: countDeviceAlerts(deviceIds, alertList)
        };
    }
}
