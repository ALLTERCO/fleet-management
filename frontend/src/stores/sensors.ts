import {defineStore} from 'pinia';
import {getLogoFromModel} from '@/helpers/device';

// BLU sensor cards render the backend-built BTHomeOverview verbatim
// (status['bthomedevice:N'].overview → kind/state/summary/battery/lastEvent);
// see buildBTHomeCard in pages/devices/index.vue. No BTHome knowledge here.
export type SensorDevice = {
    id: string;
    // Owning device — lets a card resolve its durable reading from the store.
    shellyID?: string;
    name: string;
    // Presence of the gateway that carries this BLE sensor. Optional so the
    // aggregated-sensor path (no gateway) can omit it.
    online?: boolean;
    state?: 'open' | 'closed';
    battery?: number;
    summary?: string;
    primaryDisplayValue?: string;
    lastEvent?: string;
    // Backend-formatted active channel (e.g. "Channel 2") for remote controllers.
    activeChannelLabel?: string;
    kind:
        | 'door_window'
        | 'button'
        | 'remote_controller'
        | 'motion_sensor'
        | 'climate_sensor'
        | 'distance_sensor'
        | 'trv'
        | 'weather_station'
        | 'sensor';
    modelId?: string;
    imageModel?: string;
    productName?: string;
};

export const useSensorsStore = defineStore('sensors', () => {
    function getLogo(device?: SensorDevice) {
        if (!device) return '/images/devices/generic-blu-device.png';
        const imageModel = device.imageModel ?? device.modelId;
        if (imageModel) {
            return getLogoFromModel(imageModel);
        }
        switch (device.kind) {
            case 'door_window':
                return '/images/devices/door_window.png';
            case 'button':
                return '/images/devices/button.png';
            case 'remote_controller':
                return '/images/devices/rc.png';
            case 'motion_sensor':
                return '/images/devices/motion.png';
            default:
                return '/images/devices/generic-blu-device.png';
        }
    }

    return {getLogo};
});
