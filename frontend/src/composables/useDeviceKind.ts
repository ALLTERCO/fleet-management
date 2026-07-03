import {computed, type MaybeRef, unref} from 'vue';

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

export function classifyExternalId(
    externalId: string | null | undefined
): DeviceKind {
    if (!externalId) return 'physical';
    if (BLUETOOTH_PREFIX.test(externalId)) return 'bluetooth';
    if (VIRTUAL_PREFIX.test(externalId)) return 'composed';
    return 'physical';
}

export function useDeviceKind(externalId: MaybeRef<string | null | undefined>) {
    const kind = computed<DeviceKind>(() =>
        classifyExternalId(unref(externalId))
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
