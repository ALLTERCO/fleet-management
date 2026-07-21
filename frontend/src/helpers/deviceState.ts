// Single home for the fleet-card live-state pill (top-right head zone).
// Scoped to BLU/BTHome sensors and alarm-class devices — all other device
// types resolve to null and keep their existing card look.

import {
    getBThomeBinaryStateWords,
    getBThomeVariant
} from '@/config/bthome-presentation';
import {formatBTHomeEventName} from '@/helpers/bthome-controls';
import {resolveDeviceLiveness} from '@/helpers/deviceLiveness';

/** Tones map 1:1 to the existing .bthome-state--* pill variants. */
export type DeviceStateTone = 'open' | 'closed' | 'event' | 'alarm' | 'neutral';

export interface DeviceStatePill {
    label: string;
    tone: DeviceStateTone;
    /** Last report outlived the model's expected cadence — render muted. */
    stale: boolean;
}

/** Slice of the entity store the resolver reads (backend-reported fields). */
export interface StateEntity {
    type?: string;
    properties?: {
        id?: number;
        objName?: string;
        sensorType?: string;
    };
}

export type EntityLookup = (entityId: string) => StateEntity | undefined;

interface DeviceStateInput {
    source?: string;
    status?: Record<string, any>;
    meta?: Record<string, any>;
    entities?: string[];
}

type PillDraft = Omit<DeviceStatePill, 'stale'>;

// Scoped bthome presentation variants, alarm-class first.
const SCOPED_BINARY_VARIANTS = ['smoke', 'flood', 'door', 'motion'] as const;
const ALARM_VARIANTS = new Set(['smoke', 'flood']);

// Control/meter surface → out of scope: relays, plugs, lights, covers, meters.
const OUT_OF_SCOPE_TYPES = [
    'switch',
    'light',
    'rgb',
    'rgbw',
    'cct',
    'rgbcct',
    'ledstrip',
    'cover',
    'em',
    'em1',
    'pm1'
];

export function resolveDeviceStatePill(
    device: DeviceStateInput | undefined,
    getEntity?: EntityLookup
): DeviceStatePill | null {
    const status = device?.status;
    if (!status || typeof status !== 'object') return null;
    if (device.source === 'bluetooth') {
        return bluetoothStatePill(device, getEntity);
    }
    return wiredAlarmStatePill(status);
}

// --- Wired alarm-class devices (smoke:*, flood:* components) ----------------

function wiredAlarmStatePill(
    status: Record<string, any>
): DeviceStatePill | null {
    const types = statusComponentTypes(status);
    if (OUT_OF_SCOPE_TYPES.some((type) => types.has(type))) return null;
    const draft =
        wiredAlarmDraft(status, 'smoke', 'Smoke', 'Clear') ??
        wiredAlarmDraft(status, 'flood', 'Flood', 'Dry');
    return draft ? {...draft, stale: false} : null;
}

function wiredAlarmDraft(
    status: Record<string, any>,
    type: string,
    activeLabel: string,
    idleLabel: string
): PillDraft | null {
    const alarms = componentStatuses(status, type)
        .map((s) => s?.alarm)
        .filter((alarm): alarm is boolean => typeof alarm === 'boolean');
    if (alarms.length === 0) return null;
    return alarms.some(Boolean)
        ? {label: activeLabel, tone: 'alarm'}
        : {label: idleLabel, tone: 'closed'};
}

function statusComponentTypes(status: Record<string, any>): Set<string> {
    const types = new Set<string>();
    for (const key of Object.keys(status)) {
        const i = key.indexOf(':');
        if (i > 0) types.add(key.substring(0, i));
    }
    return types;
}

function componentStatuses(status: Record<string, any>, type: string): any[] {
    return Object.keys(status)
        .filter((key) => key.startsWith(`${type}:`))
        .map((key) => status[key]);
}

// --- Promoted BLU devices (source === 'bluetooth') ---------------------------

function bluetoothStatePill(
    device: DeviceStateInput,
    getEntity?: EntityLookup
): DeviceStatePill | null {
    const status = device.status ?? {};
    const draft =
        bluBinarySensorDraft(device, status, getEntity) ??
        bluOpenClosedFallbackDraft(status) ??
        bluTrvTargetDraft(status) ??
        bluRemoteChannelDraft(status) ??
        bluButtonOverviewDraft(status) ??
        bluLastEventDraft(device, status) ??
        bluClimateSummaryDraft(status) ??
        bluReadingDraft(device, status, getEntity) ??
        bluOverviewSummaryDraft(status);
    // Freshness comes from the shared liveness resolver so the reading pill
    // and the card's status indicator never disagree.
    return draft
        ? {...draft, stale: resolveDeviceLiveness(device).stale}
        : null;
}

// Binary state via backend-reported sensorType + presentation words and
// variant derived from the backend-sent objName.
function bluBinarySensorDraft(
    device: DeviceStateInput,
    status: Record<string, any>,
    getEntity?: EntityLookup
): PillDraft | null {
    for (const variant of SCOPED_BINARY_VARIANTS) {
        const draft = bluVariantDraft(device, status, getEntity, variant);
        if (draft) return draft;
    }
    return null;
}

function bluVariantDraft(
    device: DeviceStateInput,
    status: Record<string, any>,
    getEntity: EntityLookup | undefined,
    variant: string
): PillDraft | null {
    if (!getEntity) return null;
    for (const entityId of device.entities ?? []) {
        const entity = getEntity(entityId);
        if (entity?.type !== 'bthomesensor') continue;
        if (entity.properties?.sensorType !== 'binary_sensor') continue;
        if (getBThomeVariant(entity.properties?.objName) !== variant) continue;
        const value = status[`bthomesensor:${entity.properties?.id}`]?.value;
        if (typeof value !== 'boolean') continue;
        return binaryPillDraft(entity.properties?.objName, variant, value);
    }
    return null;
}

function binaryPillDraft(
    objName: string | undefined,
    variant: string,
    value: boolean
): PillDraft {
    const words = getBThomeBinaryStateWords(objName);
    const raw = value ? words.on : words.off;
    return {
        label: titleCase(raw),
        tone: value
            ? ALARM_VARIANTS.has(variant)
                ? 'alarm'
                : 'open'
            : 'closed'
    };
}

// Door/window fallback: the backend projects a friendly `state` field onto
// opening/door/window sensor status — usable even before entities load.
function bluOpenClosedFallbackDraft(
    status: Record<string, any>
): PillDraft | null {
    for (const value of componentStatuses(status, 'bthomesensor')) {
        if (value?.state === 'open') return {label: 'Open', tone: 'open'};
        if (value?.state === 'closed') return {label: 'Closed', tone: 'closed'};
    }
    return null;
}

function bluTrvTargetDraft(status: Record<string, any>): PillDraft | null {
    for (const value of componentStatuses(status, 'blutrv')) {
        if (typeof value?.target_C === 'number') {
            return {label: `Target ${value.target_C}°C`, tone: 'neutral'};
        }
    }
    return null;
}

// Analog reading: the primary sensor's backend-stamped displayValue (temperature
// then humidity, else first with a reading; battery is a badge). Reads the
// string, never re-derives units.
const BLU_READING_PRIORITY = ['temperature', 'humidity'];

function bluReadingDraft(
    device: DeviceStateInput,
    status: Record<string, any>,
    getEntity?: EntityLookup
): PillDraft | null {
    if (!getEntity) return null;
    let best: {rank: number; label: string} | null = null;
    for (const entityId of device.entities ?? []) {
        const entity = getEntity(entityId);
        if (entity?.type !== 'bthomesensor') continue;
        // Analog only — a boolean sensor's displayValue is a state word,
        // which belongs on a state pill, not a reading.
        if (entity.properties?.sensorType !== 'sensor') continue;
        const objName = entity.properties?.objName ?? '';
        if (objName === 'battery') continue;
        const displayValue =
            status[`bthomesensor:${entity.properties?.id}`]?.displayValue;
        if (
            typeof displayValue !== 'string' ||
            !displayValue ||
            displayValue === '—'
        ) {
            continue;
        }
        const idx = BLU_READING_PRIORITY.indexOf(objName);
        const rank = idx === -1 ? BLU_READING_PRIORITY.length : idx;
        if (!best || rank < best.rank) best = {rank, label: displayValue};
    }
    return best ? {label: best.label, tone: 'neutral'} : null;
}

// Buttons/remotes: last action from event components (reported meta role).
function bluLastEventDraft(
    device: DeviceStateInput,
    status: Record<string, any>
): PillDraft | null {
    const components: Array<{componentKey?: string; role?: string}> =
        device.meta?.bluetoothDevice?.components ?? [];
    for (const component of components) {
        if (component.role !== 'event_control') continue;
        const event = status[component.componentKey ?? '']?.last_event;
        if (typeof event === 'string' && event.trim()) {
            return {label: formatBTHomeEventName(event), tone: 'event'};
        }
    }
    return null;
}

function bluRemoteChannelDraft(
    status: Record<string, any>
): PillDraft | null {
    const overview = status.bluetoothdevice?.overview;
    if (!overview || typeof overview !== 'object') return null;
    return overview.kind === 'remote_controller' &&
        typeof overview.activeChannelLabel === 'string' &&
        overview.activeChannelLabel
        ? {label: overview.activeChannelLabel, tone: 'neutral'}
        : null;
}

function bluButtonOverviewDraft(
    status: Record<string, any>
): PillDraft | null {
    const overview = status.bluetoothdevice?.overview;
    if (!overview || overview.kind !== 'button') return null;
    return {label: 'No events', tone: 'neutral'};
}

function bluClimateSummaryDraft(
    status: Record<string, any>
): PillDraft | null {
    const overview = status.bluetoothdevice?.overview;
    return overview?.kind === 'climate_sensor' &&
        typeof overview.summary === 'string' &&
        overview.summary
        ? {label: overview.summary, tone: 'neutral'}
        : null;
}

function bluOverviewSummaryDraft(
    status: Record<string, any>
): PillDraft | null {
    const overview = status.bluetoothdevice?.overview;
    if (!overview || typeof overview !== 'object') return null;
    return typeof overview.summary === 'string' && overview.summary
        ? {label: overview.summary, tone: 'neutral'}
        : null;
}

function titleCase(label: string): string {
    return formatBTHomeEventName(label.toLowerCase());
}
