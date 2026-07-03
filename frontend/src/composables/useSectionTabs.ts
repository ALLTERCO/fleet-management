import {type ComputedRef, computed} from 'vue';
import {DEVICES_PATH, WAITING_ROOM_PATH} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import type {RouteTab} from '@/types/page-template';

// Primary left-side switch shared by the Devices and Waiting Room pages. The
// two stay separate pages; these tabs only navigate between the sections. The
// Waiting Room tab carries the live pending count as its badge.
export function useDeviceSectionTabs(): ComputedRef<RouteTab[]> {
    const auth = useAuthStore();
    return computed(() => [
        {
            label: 'Devices',
            path: DEVICES_PATH,
            icon: 'fa-regular fa-hard-drive'
        },
        {
            label: 'Waiting Room',
            path: WAITING_ROOM_PATH,
            icon: 'fa-regular fa-inbox',
            badge: auth.waitingRoomCount || undefined
        }
    ]);
}
