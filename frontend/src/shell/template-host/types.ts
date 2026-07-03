import type {ComputedRef, Ref} from 'vue';

export type HostLoadState = 'idle' | 'loading' | 'ready' | 'error';

// Domain capability bag — mirrors @template-contract HostDevice.capabilities.
// Defined locally (not imported from @/types) because @/types' own
// DeviceCapabilities is FM-internal MANAGEMENT capabilities (backup,
// firmwareUpdate, matter, xmod, …) — a different concept. Templates classify
// devices by what they MEASURE (energy / temperature / relay / door /
// motion), not what management ops they support. Keep this in sync with
// business-manager-templates/contracts/host.ts.
export type DeviceEnergyCapability = {
    power_w?: number | null;
    total_energy_wh?: number | null;
};
export type DeviceTemperatureCapability = {
    temperature_c?: number | null;
    humidity_pct?: number | null;
};
export type DeviceRelayCapability = {state: boolean};
export type DeviceDoorCapability = {open: boolean};
export type DeviceMotionCapability = {detected: boolean};

export type DeviceCapabilities = {
    energy?: DeviceEnergyCapability;
    temperature?: DeviceTemperatureCapability;
    relay?: DeviceRelayCapability;
    door?: DeviceDoorCapability;
    motion?: DeviceMotionCapability;
};

export type HostAsyncState<T> = {
    state: Ref<HostLoadState>;
    loading: ComputedRef<boolean>;
    data: ComputedRef<T>;
    error: Ref<string | null>;
    refresh: () => Promise<void>;
};

export type HostResource<T> = HostAsyncState<T>;

export type HostAction<TArgs extends unknown[], TResult> = {
    pending: Ref<boolean>;
    error: Ref<string | null>;
    run: (...args: TArgs) => Promise<TResult>;
};

export type HostError = {
    code?: string;
    message: string;
    data?: unknown;
};

export type HostDevice = {
    shellyID: string;
    id?: number | string;
    name?: string;
    type?: string;
    online?: boolean;
    /** Contract-flat: 'online' | 'offline' derived from `online`. Templates
     * that follow @template-contract read this; we keep `online` too for
     * backwards compatibility with non-BM FM code paths. */
    presence?: 'online' | 'offline';
    /** First group the device belongs to — convenience flat so templates
     * can group devices by store/showroom without joining groupIds[]. */
    groupId?: number | string | null;
    groupIds?: number[];
    locationId?: number | null;
    tagIds?: number[];
    capabilities?: DeviceCapabilities;
    status?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    raw?: unknown;
};

export type HostPagedEnvelope<T> = {
    items: T[];
    total?: number;
    limit?: number;
    offset?: number;
    has_more?: boolean;
};
