// Measurement-point model for device Energy assignment. Two parts:
//   * deviceMeasurementPoints — enumerate the LIVE candidates from a device's
//     in-memory status snapshot (the only place componentKey is observable),
//     classifying each field via the shared classifier.
//   * mergeMeasurementPoints — UNION those live candidates with the persisted
//     device_em history (supplied by the handler), marking
//     source/hasHistory/isLiveNow and the assigned meter.
// The persisted history is the primary truth of what can query energy; live
// only adds the componentKey label and "available right now".

import {
    classifyObservedField,
    type EnergyDomain,
    type EnergyTag
} from '../../modules/energyClassifier';
import {meterPointKey} from './meterOwnership';

// A cached device snapshot. `online` is deliberately absent: enumeration uses
// whatever status is cached, so a wireable point can be listed even while the
// device is briefly offline. `config` carries the Shelly.GetConfig entries
// (keyed by componentKey) needed to classify value-only components.
export interface MeasurementPointSource {
    status: Record<string, unknown> | null | undefined;
    config?: Record<string, unknown> | null;
}

export interface MeasurementPointFact {
    componentKey: string;
    channel: number;
    phase: 'a' | 'b' | 'c' | 'z';
    tag: EnergyTag;
    electricalDomain: EnergyDomain;
    sampleValue: number;
}

export function deviceMeasurementPoints(
    dev: MeasurementPointSource
): MeasurementPointFact[] {
    if (!dev.status) return [];
    const seen = new Map<string, MeasurementPointFact>();
    for (const componentKey of Object.keys(dev.status)) {
        const compStatus = dev.status[componentKey];
        if (compStatus === null || typeof compStatus !== 'object') continue;
        collectComponentPoints(
            componentKey,
            compStatus as Record<string, unknown>,
            dev.config?.[componentKey],
            seen
        );
    }
    return [...seen.values()];
}

function collectComponentPoints(
    componentKey: string,
    compStatus: Record<string, unknown>,
    config: unknown,
    seen: Map<string, MeasurementPointFact>
): void {
    const channel = parseChannel(componentKey);
    for (const [fieldName, value] of flattenNumericFields(compStatus)) {
        const result = classifyObservedField({componentKey, fieldName, config});
        if (!result) continue;
        const point: MeasurementPointFact = {
            componentKey,
            channel,
            phase: result.phase,
            tag: result.tag,
            electricalDomain: result.domain,
            sampleValue: value
        };
        seen.set(pointKey(point), point);
    }
}

// Walk a component status object to dotted field paths with numeric leaves
// (e.g. aenergy.total → "aenergy.total"). The classifier keys on these names.
function* flattenNumericFields(
    obj: Record<string, unknown>,
    prefix = ''
): Generator<[string, number]> {
    for (const [key, value] of Object.entries(obj)) {
        const name = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'number' && Number.isFinite(value)) {
            yield [name, value];
        } else if (value !== null && typeof value === 'object') {
            yield* flattenNumericFields(value as Record<string, unknown>, name);
        }
    }
}

function pointKey(p: MeasurementPointFact): string {
    return `${p.componentKey}|${p.channel}|${p.phase}|${p.tag}`;
}

// A point observed to have stored history in device_em. It carries no
// componentKey — the persisted rows drop it — so the merge fills it from a
// live candidate when one resolves.
export interface HistoryPoint {
    channel: number;
    phase: 'a' | 'b' | 'c' | 'z';
    tag: EnergyTag;
    electricalDomain: EnergyDomain;
    sampleValue?: number | null;
    sampleTs?: string | null;
}

export type PointSource = 'history' | 'live' | 'both';

export interface MergedMeasurementPoint {
    deviceId: number;
    shellyID: string;
    componentKey: string | null;
    channel: number;
    phase: 'a' | 'b' | 'c' | 'z';
    tag: EnergyTag;
    electricalDomain: EnergyDomain;
    source: PointSource;
    hasHistory: boolean;
    isLiveNow: boolean;
    assignedMeterId?: number;
    sampleValue?: number | null;
    sampleTs?: string | null;
}

// Merge a device's persisted (history) and live points into one list the
// wizard can show. Identity is channel+phase+tag+electricalDomain. History is
// the durable truth (its sample wins); live contributes the componentKey and
// the "available right now" flag. assignedMeterId marks already-wired points,
// keyed by the shared (device, channel, tag) ownership grain — so every phase
// of an owned channel reads assigned, matching what SaveLogicalMeter enforces.
export function mergeMeasurementPoints(input: {
    deviceId: number;
    shellyID: string;
    history: readonly HistoryPoint[];
    live: readonly MeasurementPointFact[];
    assignments?: ReadonlyMap<string, number>;
}): MergedMeasurementPoint[] {
    const merged = new Map<string, MergedMeasurementPoint>();
    for (const h of input.history) {
        merged.set(identity(h), historyRow(input.deviceId, input.shellyID, h));
    }
    for (const l of input.live) {
        const key = identity(l);
        const existing = merged.get(key);
        if (existing) {
            existing.source = 'both';
            existing.isLiveNow = true;
            existing.componentKey = l.componentKey;
        } else {
            merged.set(key, liveRow(input.deviceId, input.shellyID, l));
        }
    }
    if (input.assignments) {
        attachAssignments(input.deviceId, merged, input.assignments);
    }
    return [...merged.values()];
}

function identity(p: {
    channel: number;
    phase: string;
    tag: string;
    electricalDomain: string;
}): string {
    return `${p.channel}|${p.phase}|${p.tag}|${p.electricalDomain}`;
}

function historyRow(
    deviceId: number,
    shellyID: string,
    h: HistoryPoint
): MergedMeasurementPoint {
    return {
        deviceId,
        shellyID,
        componentKey: null,
        channel: h.channel,
        phase: h.phase,
        tag: h.tag,
        electricalDomain: h.electricalDomain,
        source: 'history',
        hasHistory: true,
        isLiveNow: false,
        sampleValue: h.sampleValue ?? null,
        sampleTs: h.sampleTs ?? null
    };
}

function liveRow(
    deviceId: number,
    shellyID: string,
    l: MeasurementPointFact
): MergedMeasurementPoint {
    return {
        deviceId,
        shellyID,
        componentKey: l.componentKey,
        channel: l.channel,
        phase: l.phase,
        tag: l.tag,
        electricalDomain: l.electricalDomain,
        source: 'live',
        hasHistory: false,
        isLiveNow: true,
        sampleValue: l.sampleValue,
        sampleTs: null
    };
}

function attachAssignments(
    deviceId: number,
    merged: Map<string, MergedMeasurementPoint>,
    assignments: ReadonlyMap<string, number>
): void {
    for (const p of merged.values()) {
        const meterId = assignments.get(
            meterPointKey(deviceId, p.channel, p.tag)
        );
        if (meterId !== undefined) p.assignedMeterId = meterId;
    }
}

function parseChannel(componentKey: string): number {
    const colon = componentKey.indexOf(':');
    if (colon === -1) return 0;
    return Number.parseInt(componentKey.slice(colon + 1), 10) || 0;
}
