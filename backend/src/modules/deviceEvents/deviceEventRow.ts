// Row shape + path parsing for the device event log. One home for the
// device.fn_event_log_add_batch param mapping so the logger and any future
// drainer persist rows identically (mirrors auditBatchRow.ts).

import type {PathChange} from '../../types';

type DeviceEventKind = 'state_change' | 'event' | 'config';
type DeviceEventSource = 'device' | 'command' | 'unknown';

// Queued entry — one leaf change. `ts` is the device-reported time as ISO,
// preserved verbatim; stamped NOW() by the logger only when absent.
export interface DeviceEventEntry {
    ts?: string;
    deviceId: number;
    shellyId: string;
    organizationId?: string;
    component: string;
    field: string;
    prev: unknown;
    next: unknown;
    kind: DeviceEventKind;
    source: DeviceEventSource;
}

// Snake-case shape handed to the batch-insert fn. prev/next stay raw JS
// values — JSON.stringify of the array embeds them; the SQL casts e->'prev'.
export interface DeviceEventBatchRow {
    ts: string | null;
    device_id: number;
    shelly_id: string;
    organization_id: string | null;
    component: string;
    field: string;
    prev: unknown;
    next: unknown;
    kind: string;
    source: string;
}

export function entryToBatchRow(entry: DeviceEventEntry): DeviceEventBatchRow {
    return {
        ts: entry.ts ?? null,
        device_id: entry.deviceId,
        shelly_id: entry.shellyId,
        organization_id: entry.organizationId ?? null,
        component: entry.component,
        field: entry.field,
        prev: entry.prev ?? null,
        next: entry.next ?? null,
        kind: entry.kind,
        source: entry.source
    };
}

// Split a merge dot-path into its component key + leaf field. Splits on the
// FIRST dot only — Shelly component keys ("switch:0") never contain a dot,
// the leaf may ("aenergy.total"). Whole-component paths (no dot) get field ''.
export function pathToComponentField(path: string): {
    component: string;
    field: string;
} {
    const dot = path.indexOf('.');
    if (dot === -1) return {component: path, field: ''};
    return {component: path.slice(0, dot), field: path.slice(dot + 1)};
}

// Device ts arrives as Unix epoch seconds (Shelly NotifyStatus.ts, possibly
// fractional). Convert to ISO so the timestamptz cast preserves it verbatim.
// Returns undefined for absent/non-finite input — logger stamps NOW() then.
export function epochSecToIso(sec: number | undefined): string | undefined {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return undefined;
    return new Date(sec * 1000).toISOString();
}

export interface ChangeCapture {
    deviceId: number;
    shellyId: string;
    organizationId?: string;
    /** Device-reported time (Unix epoch seconds). Preserved verbatim. */
    tsEpochSec?: number;
    changes: readonly PathChange[];
    kind?: DeviceEventKind;
    source?: DeviceEventSource;
}

// Pure fan-out: one entry per leaf change, never coalesced. Component/field
// derived from the path; the device timestamp applied to every row verbatim.
export function changesToEntries(input: ChangeCapture): DeviceEventEntry[] {
    const ts = epochSecToIso(input.tsEpochSec);
    const kind = input.kind ?? 'state_change';
    const source = input.source ?? 'device';
    const entries: DeviceEventEntry[] = [];
    for (const change of input.changes) {
        const {component, field} = pathToComponentField(change.path);
        const isBthomeSensor = component.startsWith('bthomesensor:');
        // displayValue is a derived reading, never a device state — never audit
        // it: as its own field, or embedded in a whole-component snapshot (a
        // new sensor's first status). Scoped to bthomesensor.
        if (isBthomeSensor && field === 'displayValue') continue;
        let next = change.next;
        if (
            isBthomeSensor &&
            next &&
            typeof next === 'object' &&
            !Array.isArray(next)
        ) {
            const {displayValue: _dv, ...rest} = next as Record<
                string,
                unknown
            >;
            next = rest;
        }
        entries.push({
            ts,
            deviceId: input.deviceId,
            shellyId: input.shellyId,
            organizationId: input.organizationId,
            component,
            field,
            prev: change.prev,
            next,
            kind,
            source
        });
    }
    return entries;
}
