// One device identity pipeline for pickers — same name + photo source as the
// device grid (getDeviceName + resolveDeviceCardLogo), never raw backend fields.

import {GENERIC_LOGO, getDeviceName} from '@/helpers/device';
import {type DeviceLogo, resolveDeviceCardLogo} from '@/helpers/deviceLogo';
import {useDevicesStore} from '@/stores/devices';

export function useDeviceIdentity() {
    const devicesStore = useDevicesStore();

    function deviceLogoById(externalId: string): DeviceLogo {
        const device = devicesStore.devices[externalId];
        if (device) return resolveDeviceCardLogo(device);
        // Unknown to the store — no model to resolve, so the generic logo.
        return {kind: 'image', src: GENERIC_LOGO};
    }

    function deviceNameById(externalId: string, fallback?: string): string {
        const device = devicesStore.devices[externalId];
        if (device) return getDeviceName(device.info, device.shellyID);
        return fallback?.trim() ? fallback : externalId;
    }

    return {deviceLogoById, deviceNameById};
}
