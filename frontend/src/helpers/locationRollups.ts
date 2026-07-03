/** Pure rollup helpers for the location tree.
 *
 *  Every function here is side-effect-free and accepts only the data it
 *  reads. The composable `useLocationRollups` wires these up to the Pinia
 *  stores; everything else uses the composable. */

import type {ApiLocation, LocationAssignment} from '@/stores/locations';

/** Parent→children lookup, built once per locations snapshot. */
export type ChildIndex = ReadonlyMap<number, readonly number[]>;

export interface OnlineSplit {
    readonly online: number;
    readonly offline: number;
    readonly warning: number;
}

/** Build the parent→children lookup table.
 *  Root locations (parentLocationId === null) are not present as keys —
 *  the store tracks roots separately, so callers don't need them here. */
export function buildChildIndex(
    locations: Readonly<Record<number, ApiLocation>>
): ChildIndex {
    const index = new Map<number, number[]>();
    for (const location of Object.values(locations)) {
        const parent = location.parentLocationId;
        if (parent == null) continue;
        appendChild(index, parent, location.id);
    }
    return index;
}

function appendChild(
    index: Map<number, number[]>,
    parent: number,
    child: number
): void {
    const siblings = index.get(parent);
    if (siblings) siblings.push(child);
    else index.set(parent, [child]);
}

/** Every location ID reachable from rootId (including rootId itself).
 *  Cycle-safe via a visited set — a malformed tree will not infinite-loop. */
export function collectSubtreeIds(
    rootId: number,
    children: ChildIndex
): readonly number[] {
    const visited = new Set<number>();
    const stack: number[] = [rootId];
    const result: number[] = [];
    while (stack.length > 0) {
        const id = stack.pop() as number;
        if (visited.has(id)) continue;
        visited.add(id);
        result.push(id);
        const kids = children.get(id);
        if (kids) stack.push(...kids);
    }
    return result;
}

/** Device IDs assigned to any of the given locations.
 *  Entity assignments are skipped — call collectAssignedEntities for those. */
export function collectAssignedDevices(
    locationIds: readonly number[],
    assignments: Readonly<Record<number, readonly LocationAssignment[]>>
): readonly string[] {
    const deviceIds: string[] = [];
    for (const locationId of locationIds) {
        const items = assignments[locationId];
        if (!items) continue;
        for (const item of items) {
            if (item.subjectType === 'device') deviceIds.push(item.subjectId);
        }
    }
    return deviceIds;
}

/** Split device IDs into online / offline counts.
 *  Unknown device IDs count as offline — a missing-from-store device is
 *  more likely down than recently added, so the safer default is offline. */
export function countOnlineSplit(
    deviceIds: readonly string[],
    onlineByDeviceId: Readonly<Record<string, boolean>>
): OnlineSplit {
    let online = 0;
    let offline = 0;
    for (const id of deviceIds) {
        if (onlineByDeviceId[id] === true) online += 1;
        else offline += 1;
    }
    return {online, offline, warning: 0};
}

/** Minimal alert shape we read for the rollup.
 *  Decoupled from the full AlertInstance to keep the helper pure and
 *  testable without dragging the entire alert types module along. */
export interface AlertForRollup {
    readonly state:
        | 'pending'
        | 'active'
        | 'acknowledged'
        | 'recovering'
        | 'cleared_unack'
        | 'cleared_ack'
        | 'no_data'
        | 'evaluation_error'
        | 'resolved';
    readonly source: {
        readonly subjectType: string;
        readonly subjectId: string;
    };
}

// Closed lifecycle states — neither contributes to the rollup count.
const CLOSED_STATES = new Set<AlertForRollup['state']>([
    'resolved',
    'cleared_ack'
]);

/** Count alerts whose source is a device in the given subtree.
 *  Closed states (resolved, cleared+acked) don't count. cleared_unack still
 *  counts because the human hasn't finished triaging it. */
export function countDeviceAlerts(
    deviceIds: readonly string[],
    alerts: Iterable<AlertForRollup>
): number {
    const deviceSet = new Set(deviceIds);
    let count = 0;
    for (const alert of alerts) {
        if (CLOSED_STATES.has(alert.state)) continue;
        if (alert.source.subjectType !== 'device') continue;
        if (deviceSet.has(alert.source.subjectId)) count += 1;
    }
    return count;
}

/** Minimal device shape we read for power/temperature rollups.
 *  Status is a dynamic object — every Shelly component (switch:0, pm1:0,
 *  temperature:0, …) attaches its own keys. We scan every key looking
 *  for known numeric fields. */
export interface DeviceForRollup {
    readonly status?: Readonly<Record<string, unknown>> | null | undefined;
}

/** Sum apparent power across every metering component on every device
 *  in the subtree. Mirrors the pattern in useGroupStats — scans every
 *  status sub-object for `apower` (Shelly EM / PM1 / Switch) or
 *  `act_power` (3EM / EM3). Returns null when no metering surface was
 *  found, so the KPI strip can hide the metric cleanly. */
export function sumDevicePower(
    deviceIds: readonly string[],
    devicesById: Readonly<Record<string, DeviceForRollup>>
): number | null {
    let sum = 0;
    let found = false;
    for (const id of deviceIds) {
        const device = devicesById[id];
        if (!device?.status) continue;
        for (const value of Object.values(device.status)) {
            if (!value || typeof value !== 'object') continue;
            const v = value as Record<string, unknown>;
            const watts = readNumeric(v.apower) ?? readNumeric(v.act_power);
            if (watts == null) continue;
            sum += watts;
            found = true;
        }
    }
    return found ? sum : null;
}

function readNumeric(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface TemperatureSummaryC {
    readonly minCelsius: number;
    readonly avgCelsius: number;
    readonly maxCelsius: number;
}

/** Walk every device's status, collect `tC` (Shelly temperature
 *  component, Celsius), and return min / avg / max. Returns null when
 *  no temperature surface was found — KPI strip hides the metric. */
export function summarizeDeviceTemperature(
    deviceIds: readonly string[],
    devicesById: Readonly<Record<string, DeviceForRollup>>
): TemperatureSummaryC | null {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let count = 0;
    for (const id of deviceIds) {
        const device = devicesById[id];
        if (!device?.status) continue;
        for (const value of Object.values(device.status)) {
            if (!value || typeof value !== 'object') continue;
            const reading = readNumeric((value as Record<string, unknown>).tC);
            if (reading == null) continue;
            if (reading < min) min = reading;
            if (reading > max) max = reading;
            sum += reading;
            count += 1;
        }
    }
    if (count === 0) return null;
    return {minCelsius: min, avgCelsius: sum / count, maxCelsius: max};
}
