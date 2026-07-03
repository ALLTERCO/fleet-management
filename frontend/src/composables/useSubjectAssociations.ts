/** Device → tagIds[] / locationIds[] reverse index. Derived from
 *  devicesStore (which carries the FKs from fn_device_memberships).
 *
 *  Perf note: each `computed()` is auto-memoized by Vue and re-runs only
 *  when its tracked reactive deps change. With Vue 3's per-key reactivity,
 *  status / settings updates on a device do NOT invalidate these — only
 *  add/remove of devices and changes to `tagIds`/`locationId` do. */
import {type ComputedRef, computed} from 'vue';
import {useDevicesStore} from '../stores/devices';

export interface SubjectAssociations {
    tagsByDevice: ComputedRef<Record<string, number[]>>;
    locationsByDevice: ComputedRef<Record<string, number[]>>;
}

export function useSubjectAssociations(): SubjectAssociations {
    const devicesStore = useDevicesStore();

    const tagsByDevice = computed(() => {
        const out: Record<string, number[]> = {};
        for (const [shellyID, dev] of Object.entries(devicesStore.devices)) {
            if (dev.tagIds?.length) out[shellyID] = [...dev.tagIds];
        }
        return out;
    });

    const locationsByDevice = computed(() => {
        const out: Record<string, number[]> = {};
        for (const [shellyID, dev] of Object.entries(devicesStore.devices)) {
            if (dev.locationId != null) out[shellyID] = [dev.locationId];
        }
        return out;
    });

    return {tagsByDevice, locationsByDevice};
}
