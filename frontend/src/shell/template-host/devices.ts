import type {DeviceListParams} from '@api/device';
import {type ComputedRef, computed} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {hostRpcAccess} from './api';
import {deriveDomainCapabilities} from './core/device-capabilities';
import {toHostDevice} from './core/device-mapper';
import {createDeviceDomain} from './core/domains/devices';
import type {
    HostAsyncState,
    HostDevice,
    HostLoadState,
    HostResource
} from './types';
import {useDevices as useLiveDevices} from './vue/composables/useDevices';

/** Legacy Vue entry point, backed by the same live Host SDK resource. */
export function useDevices(): HostResource<HostDevice[]> {
    const live = useLiveDevices();
    const data = computed<HostDevice[]>(() => [...live.data.value]);
    const error = computed<string | null>(
        () => live.error.value?.message ?? null
    );
    return {
        state: live.state,
        loading: live.loading,
        data,
        error,
        refresh: live.refresh,
        updatedAt: live.updatedAt,
        freshness: live.freshness
    };
}

export function useDevicesForGroup(groupId: number): ComputedRef<HostDevice[]> {
    const store = useDevicesStore();
    return computed(() =>
        store
            .getDevices()
            .filter((device) => device.groupIds?.includes(groupId))
            .map(toHostDevice)
    );
}

export function useDeviceCapabilities(shellyID: string) {
    const store = useDevicesStore();
    // Same domain-vs-management contract as toHostDevice — never pass FM's
    // raw `device.capabilities` here. Templates expect what the device
    // measures (energy / temperature / relay / door / motion).
    return computed(() => {
        const dev = store.devices[shellyID];
        if (!dev) return {} as HostDevice['capabilities'];
        return deriveDomainCapabilities(dev);
    });
}

export function useDeviceActions(shellyID: string) {
    const store = useDevicesStore();
    return computed(() => ({
        shellyID,
        methods: store.devices[shellyID]?.methods ?? [],
        capabilities: store.devices[shellyID]?.capabilities ?? {}
    }));
}

// Bound to the Fleet transport; the behaviour lives in the core so any
// transport, real or fake, gets the same result.
export const devices = createDeviceDomain(hostRpcAccess);

export type {DeviceListParams, HostAsyncState, HostDevice, HostLoadState};
