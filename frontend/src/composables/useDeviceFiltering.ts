import {storeToRefs} from 'pinia';
import {type ComputedRef, computed, isRef, type Ref} from 'vue';
import {useGroupsStore} from '@/stores/groups';
import type {shelly_device_t} from '@/types';

export function useDeviceFiltering(
    devices:
        | shelly_device_t[]
        | Ref<shelly_device_t[]>
        | ComputedRef<shelly_device_t[]>,
    filters: {online: boolean | null; type: string; group: string}
) {
    const groupStore = useGroupsStore();
    const {groups} = storeToRefs(groupStore);

    const filtered = computed(() => {
        const deviceList = isRef(devices) ? devices.value : devices;

        // Hoist group lookup: find the group once, build a Set for O(1) device membership check
        let groupDeviceSet: Set<string> | null = null;
        if (filters.group !== 'All groups') {
            const grp = Object.values(groups.value).find(
                (g) => g.name === filters.group
            );
            groupDeviceSet = grp ? new Set(grp.devices) : new Set();
        }

        return deviceList.filter((d) => {
            if (filters.online !== null && d.online !== filters.online)
                return false;
            if (filters.type !== 'All devices' && d.info?.app !== filters.type)
                return false;
            if (groupDeviceSet && !groupDeviceSet.has(d.shellyID)) return false;
            return true;
        });
    });

    return {filtered};
}
