// Device-scoped views over the live device list. Each asks the backend for the
// devices it needs, so no view re-implements a filter over a full fetch.

import type {DeviceCapabilities, HostDevice} from '../../core/types';
import {useDevices} from './useFleetData';

/** Devices in one group, filtered by the backend rather than the client. */
export function useDevicesForGroup(groupId: number) {
    return useDevices({filters: {groupId}});
}

function useDevice(shellyID: string): HostDevice | undefined {
    return useDevices({filters: {shellyID}}).data[0];
}

/** What the device MEASURES. `useDeviceActions` answers what it can DO. */
export function useDeviceCapabilities(shellyID: string): DeviceCapabilities {
    return useDevice(shellyID)?.capabilities ?? {};
}

/** The device's own method list plus the management operations it supports. */
export function useDeviceActions(shellyID: string) {
    const device = useDevice(shellyID);
    return {
        shellyID,
        methods: device?.methods ?? [],
        capabilities: device?.supports ?? {}
    };
}
