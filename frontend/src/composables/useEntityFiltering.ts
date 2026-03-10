import {storeToRefs} from 'pinia';
import {computed} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';

const TYPE_ENTITY_MAP: Record<string, string[]> = {
    switch: ['switch'],
    light: ['light'],
    input: ['input'],
    temperature: ['temperature'],
    'energy meter': ['em', 'em1'],
    'blu sensor': ['bthomesensor', 'bthomedevice'],
    'virtual component': ['boolean', 'number', 'enum', 'text', 'group', 'button']
};

export function useEntityFiltering(
    entities: entity_t[],
    filters: {online: boolean | null; type: string}
) {
    const deviceStore = useDevicesStore();
    const {devices} = storeToRefs(deviceStore);

    const filtered = computed(() => {
        return entities.filter((e) => {
            // online
            if (filters.online !== null) {
                const device = devices.value[e.source];
                if (device && device.online !== filters.online) return false;
            }

            // type
            if (filters.type !== 'All entities') {
                const lowercase = filters.type.toLowerCase();
                const allowedTypes = TYPE_ENTITY_MAP[lowercase];

                if (allowedTypes) {
                    if (!allowedTypes.includes(e.type)) return false;
                } else {
                    if (e.type.toLowerCase() !== lowercase) return false;
                }
            }

            return true;
        });
    });

    return {filtered};
}
