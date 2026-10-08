import type {ComputedRef, Ref} from 'vue';
import type {
    DeviceCapabilities,
    DeviceDoorCapability,
    DeviceEnergyCapability,
    DeviceLeakCapability,
    DeviceMotionCapability,
    DeviceRelayCapability,
    DeviceSmokeCapability,
    DeviceTemperatureCapability,
    FleetFreshness,
    HostDevice,
    HostDeviceComponent,
    HostError,
    HostLoadState,
    HostPagedEnvelope
} from './core/types';

export type {
    DeviceCapabilities,
    DeviceDoorCapability,
    DeviceEnergyCapability,
    DeviceLeakCapability,
    DeviceMotionCapability,
    DeviceRelayCapability,
    DeviceSmokeCapability,
    DeviceTemperatureCapability,
    FleetFreshness,
    HostDevice,
    HostDeviceComponent,
    HostError,
    HostLoadState,
    HostPagedEnvelope
};

export type HostAsyncState<T> = {
    state: Ref<HostLoadState>;
    loading: ComputedRef<boolean>;
    data: ComputedRef<T>;
    error: Ref<string | null>;
    refresh: () => Promise<void>;
};

/** How old the data is, and whether anything is still keeping it current.
 *  Loading says a request is in flight; these say what is on screen now. */
export type HostResourceFreshness = {
    /** Epoch millis of the last successful load; null before the first one. */
    updatedAt: ComputedRef<number | null>;
    freshness: ComputedRef<FleetFreshness>;
};

export type HostResource<T> = HostAsyncState<T> & HostResourceFreshness;

export type HostAction<TArgs extends unknown[], TResult> = {
    pending: Ref<boolean>;
    error: Ref<string | null>;
    run: (...args: TArgs) => Promise<TResult>;
};
