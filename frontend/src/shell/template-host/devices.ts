import type {DeviceListParams} from '@api/device';
import {type ComputedRef, computed, ref} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {deriveDomainCapabilities} from './deviceCapabilities';
import {toHostDevice} from './deviceMapper';
import {hostRpc} from './rpc';
import {callMethod, type HostParams, type HostResult} from './typed';
import type {HostAsyncState, HostDevice, HostLoadState} from './types';

export function useDevices(): HostAsyncState<HostDevice[]> {
    const store = useDevicesStore();
    const state = ref<HostLoadState>('idle');
    const loading = computed(() => state.value === 'loading');
    const error = ref<string | null>(null);
    const data = computed(() => store.getDevices().map(toHostDevice));

    async function refresh(): Promise<void> {
        state.value = 'loading';
        error.value = null;
        try {
            await store.fetchDevices();
            state.value = 'ready';
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err);
            state.value = 'error';
        }
    }

    return {state, loading, data, error, refresh};
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

export const devices = {
    async list(params: DeviceListParams = {}): Promise<HostDevice[]> {
        const res = await hostRpc<{items: unknown[]}>('device.list', params);
        return (res.items ?? []).map(toHostDevice);
    },
    async get(shellyID: string): Promise<HostDevice> {
        return toHostDevice(await hostRpc('device.get', {shellyID}));
    },
    async delete(shellyID: string): Promise<{deleted: string}> {
        return callMethod('device.delete', {shellyID});
    },
    // Soft delete: hides the device but keeps its id and history. Reversible.
    async retire(shellyID: string): Promise<{retired: string}> {
        return callMethod('device.retire', {shellyID});
    },
    async restore(shellyID: string): Promise<{restored: string}> {
        return callMethod('device.restore', {shellyID});
    },
    async listRetired(): Promise<HostResult<'device.listretired'>> {
        return callMethod('device.listretired', {});
    },
    // Hardware swap: keeps id + history. checkReplacement, then replaceHardware.
    async checkReplacement(
        input: HostParams<'device.checkreplacement'>
    ): Promise<HostResult<'device.checkreplacement'>> {
        return callMethod('device.checkreplacement', input);
    },
    async replaceHardware(
        input: HostParams<'device.replacehardware'>
    ): Promise<HostResult<'device.replacehardware'>> {
        return callMethod('device.replacehardware', input);
    },
    async setKind(
        input: HostParams<'device.setkind'>
    ): Promise<HostResult<'device.setkind'>> {
        return callMethod('device.setkind', input);
    },
    async getKind(shellyID: string): Promise<HostResult<'device.getkind'>> {
        return callMethod('device.getkind', {shellyID});
    },
    async setImage(
        input: HostParams<'device.setimage'>
    ): Promise<HostResult<'device.setimage'>> {
        return callMethod('device.setimage', input);
    },
    async getImage(
        input: HostParams<'device.getimage'>
    ): Promise<HostResult<'device.getimage'>> {
        return callMethod('device.getimage', input);
    },
    async capabilities(shellyID: string): Promise<HostDevice['capabilities']> {
        return (await devices.get(shellyID)).capabilities ?? {};
    },
    async call(
        shellyID: string,
        method: string,
        params: Record<string, unknown> = {}
    ): Promise<unknown> {
        return hostRpc('device.call', {shellyID, method, params});
    }
};

export type {HostAsyncState, HostDevice, HostLoadState};
