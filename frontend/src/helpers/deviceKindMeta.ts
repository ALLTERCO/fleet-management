import type {WizardKind} from '@/stores/virtualDeviceDraftStore';

export interface DeviceKindMeta {
    label: string;
    icon: string;
    hint: string;
    idleMessage: string;
    disabled?: boolean;
    badge?: string;
}

type ConcreteKind = Exclude<WizardKind, null>;

export const DEVICE_KIND_META: Record<ConcreteKind, DeviceKindMeta> = {
    physical: {
        label: 'Real device',
        // Resolved to ShellyDeviceGlyph.vue by icon renderers.
        icon: 'glyph:shelly-device',
        hint: 'A Shelly on your network',
        idleMessage: 'Pick a device on the network or enter its IP.'
    },
    bluetooth: {
        label: 'Bluetooth device',
        icon: 'fab fa-bluetooth-b',
        hint: 'A BLU sensor via a gateway',
        idleMessage: 'Pick a gateway, then scan for nearby sensors.'
    },
    composed: {
        label: 'Custom device',
        icon: 'fas fa-layer-group',
        hint: 'Build from devices you have',
        idleMessage: 'Pick a profile and bind components to see the preview.'
    },
    extracted: {
        label: 'Extracted device',
        icon: 'fas fa-up-right-from-square',
        hint: 'Turn a group into a device',
        idleMessage: 'Pick a host device to extract a group from.'
    },
    connector: {
        label: 'Connector',
        icon: 'fas fa-plug',
        hint: 'Modbus · OPC UA',
        idleMessage: 'Coming soon.',
        disabled: true,
        badge: 'Soon'
    }
};

export const DEVICE_KIND_ORDER: ConcreteKind[] = [
    'physical',
    'bluetooth',
    'composed',
    'connector'
];

export function deviceKindLabel(kind: WizardKind): string {
    return kind ? DEVICE_KIND_META[kind].label : '';
}

export function deviceKindIcon(kind: WizardKind): string {
    return kind ? DEVICE_KIND_META[kind].icon : '';
}
