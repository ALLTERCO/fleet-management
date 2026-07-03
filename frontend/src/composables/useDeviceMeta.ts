// Computed accent color + primary-type label per device. Reusable across
// any UI that needs a quick visual signature for a device tile (widget
// picker, device board, monitoring views).

import {computed} from 'vue';
import {rgbForAccent} from '@/helpers/widgetCatalog';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';

export interface DeviceMetaEntry {
    accent: string;
    accentRgb: string;
    label: string;
}

// Default when the device has no entities yet (still booting / discovered).
const DEFAULT_LABEL = 'DEVICE';
const DEFAULT_ACCENT = 'blue';

// Type → accent map. First-match wins so the order matters: rich-visual
// types (lights, covers) take precedence over indicator-only types (power
// meters, motion). Updating this map is the only place new accents need
// to be wired in.
const ACCENT_RULES: Array<{accent: string; types: string[]}> = [
    {accent: 'pink', types: ['rgb', 'rgbw', 'cct', 'rgbcct']},
    {accent: 'amber', types: ['dimmer', 'light']},
    {accent: 'teal', types: ['cover', 'roller']},
    {accent: 'green', types: ['thermostat', 'blutrv']},
    {accent: 'purple', types: ['temperature', 'humidity', 'illuminance']},
    {accent: 'amber', types: ['em', 'em1', 'pm1', 'em3']},
    {accent: 'orange', types: ['motion']},
    {accent: 'teal', types: ['flood', 'door']},
    {accent: 'red', types: ['smoke']}
];

// Label priority — first match wins. Lights+covers read better than
// raw "input/button" so they're higher.
const LABEL_PRIORITY = [
    'cover',
    'thermostat',
    'blutrv',
    'dimmer',
    'light',
    'rgbw',
    'rgb',
    'camera',
    'media',
    'switch',
    'em',
    'em3',
    'temperature',
    'humidity',
    'motion',
    'flood',
    'smoke',
    'door',
    'input',
    'button'
];

// Answer — accent name for a device given the set of entity types it
// exposes. Falls back to the default accent when no rule matches.
function accentFor(types: Set<string>): string {
    for (const rule of ACCENT_RULES) {
        if (rule.types.some((t) => types.has(t))) return rule.accent;
    }
    return DEFAULT_ACCENT;
}

// Answer — primary type label for a device tile.
function labelFor(types: Set<string>): string {
    for (const t of LABEL_PRIORITY) {
        if (types.has(t)) return t.toUpperCase();
    }
    return DEFAULT_LABEL;
}

// Answer — reactive map of shellyID → meta for every device in the store.
// One pass over entities to build source→types, then one pass over
// devices to assemble the meta. O(m + n).
export function useDeviceMeta() {
    const deviceStore = useDevicesStore();
    const entityStore = useEntityStore();

    const deviceMeta = computed<Record<string, DeviceMetaEntry>>(() => {
        const sourceTypes = new Map<string, Set<string>>();
        for (const e of Object.values(entityStore.entities)) {
            let bucket = sourceTypes.get(e.source);
            if (!bucket) {
                bucket = new Set();
                sourceTypes.set(e.source, bucket);
            }
            bucket.add(e.type);
        }

        const meta: Record<string, DeviceMetaEntry> = {};
        for (const dev of Object.values(deviceStore.devices)) {
            const types = sourceTypes.get(dev.shellyID);
            if (!types) {
                meta[dev.shellyID] = {
                    accent: DEFAULT_ACCENT,
                    accentRgb: rgbForAccent(DEFAULT_ACCENT),
                    label: DEFAULT_LABEL
                };
                continue;
            }
            const accent = accentFor(types);
            meta[dev.shellyID] = {
                accent,
                accentRgb: rgbForAccent(accent),
                label: labelFor(types)
            };
        }
        return meta;
    });

    return {deviceMeta};
}

// Answer — CSS background gradient for a device-accent bar. Offline
// devices fade to a neutral "off" gradient so the visual cue matches
// the dot indicator.
export function devAccentGradient(args: {
    accentRgb: string;
    online: boolean;
}): string {
    if (!args.online) {
        return 'linear-gradient(90deg, color-mix(in srgb, var(--color-status-off) 80%, transparent) 0%, color-mix(in srgb, var(--color-status-off) 13%, transparent) 50%, transparent 100%)';
    }
    const rgb = args.accentRgb;
    return `linear-gradient(90deg, rgb(${rgb}) 0%, rgba(${rgb}, 0.13) 50%, transparent 100%)`;
}
