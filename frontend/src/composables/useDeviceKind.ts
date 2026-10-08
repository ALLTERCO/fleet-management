import type {DeviceSource} from '@api/deviceSource';
import {computed, type MaybeRef, unref} from 'vue';

export type {DeviceSource};

export type DeviceKind =
    | 'physical'
    | 'bluetooth'
    | 'extracted'
    | 'composed'
    | 'connector';

export interface DeviceKindFlags {
    kind: DeviceKind;
    isPhysical: boolean;
    isBluetooth: boolean;
    isVirtual: boolean;
}

const VIRTUAL_PREFIX = /^vdev_/;
const BLUETOOTH_PREFIX = /^blu_/;

// Fallback for records that arrive without the backend source field.
function classifyByIdPrefix(externalId: string | null | undefined): DeviceKind {
    if (!externalId) return 'physical';
    if (BLUETOOTH_PREFIX.test(externalId)) return 'bluetooth';
    if (VIRTUAL_PREFIX.test(externalId)) return 'composed';
    return 'physical';
}

// Keyed by the backend union, so a new source is a build error here.
const SOURCE_TO_KIND: Record<DeviceSource, DeviceKind> = {
    ws: 'physical',
    local: 'physical',
    offline: 'physical',
    virtual: 'composed',
    bluetooth: 'bluetooth'
};

/** Backend-sent device.source is the classification; id prefix only as fallback. */
export function classifyDevice(
    source: DeviceSource | null | undefined,
    externalId?: string | null
): DeviceKind {
    return (
        (source && SOURCE_TO_KIND[source]) ?? classifyByIdPrefix(externalId)
    );
}

export function useDeviceKind(
    externalId: MaybeRef<string | null | undefined>,
    source?: MaybeRef<DeviceSource | null | undefined>
) {
    const kind = computed<DeviceKind>(() =>
        classifyDevice(unref(source), unref(externalId))
    );
    const isPhysical = computed(() => kind.value === 'physical');
    const isBluetooth = computed(() => kind.value === 'bluetooth');
    const isVirtual = computed(
        () =>
            kind.value === 'composed' ||
            kind.value === 'extracted' ||
            kind.value === 'connector'
    );
    const showsPhysicalPanels = computed(
        () => isPhysical.value || isBluetooth.value
    );

    return {kind, isPhysical, isBluetooth, isVirtual, showsPhysicalPanels};
}
