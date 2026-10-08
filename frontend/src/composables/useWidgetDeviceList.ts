import {computed} from 'vue';
import {getDeviceName, isDiscovered} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import type {shelly_device_t} from '@/types';

// The device list a widget config form offers: real (non-discovered) devices,
// sorted by name. One home, so the add modal and the config modal show the same
// list in the same order.
export function useWidgetDeviceList() {
    const deviceStore = useDevicesStore();
    return computed<shelly_device_t[]>(() =>
        Object.values(deviceStore.devices)
            .filter((d) => !isDiscovered(d.shellyID))
            .sort((a, b) =>
                getDeviceName(a.info, a.shellyID).localeCompare(
                    getDeviceName(b.info, b.shellyID)
                )
            )
    );
}
