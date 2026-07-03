// Single source for resolving a tag assignment's subject to a display name.
// The subject stores (devices/entities/groups/locations) are loaded app-wide
// on WS connect, so these lookups resolve; falls back to the id otherwise.

import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import type {TagAssignmentRef} from '@/stores/tags';

export function useTagSubjectName() {
    const devices = useDevicesStore();
    const locations = useLocationsStore();
    const groups = useGroupsStore();
    const entities = useEntityStore();

    function subjectName(item: TagAssignmentRef): string {
        const id = item.subjectId;
        switch (item.subjectType) {
            case 'device':
                return devices.getDeviceName(id) ?? id;
            case 'location':
                return locations.locations[Number(id)]?.name || id;
            case 'group':
                return groups.groups[Number(id)]?.name || id;
            case 'entity':
                return entities.entities[id]?.name || id;
            default:
                return id;
        }
    }

    return {subjectName};
}
