// Bucket-aware meter grouper — the single home for energy grouping. Given the
// per-bucket per-meter rows attributeMeterEnergy emits and the meters' meaning
// (role / kind / utility), it folds each physical meter's per-bucket value into
// one series per dimension. The report's byRole/byKind/byUtility breakdown and
// the live Energy.Query group-by both call this, so they cannot drift.
//
// Pure — no DB, no clock. Energy only: attribution already restricted the input
// to additive counters; here each meter contributes its primary metric tag once
// per bucket (never summing consumption with export).

import type {
    EnergyGroupDimension,
    EnergyGroupRow,
    EnergyLogicalMeter,
    EnergyQueryRow
} from '../../types/api/energy';

// The additive metric + display unit per utility. Electric folds only
// consumption (total_act_energy) — folding export would over-report a
// bidirectional meter. Gas/water are volume; heat is thermal kWh. Ordered:
// the first tag with data wins, so a meter contributes one value per bucket.
export function meterMetric(utilityType: string): {
    tags: readonly string[];
    unit: string;
} {
    if (utilityType === 'gas' || utilityType === 'water') {
        return {tags: ['volume_m3', 'volume_l'], unit: 'volume'};
    }
    if (utilityType === 'heat') {
        return {tags: ['thermal_energy_kwh', 'total_act_energy'], unit: 'kWh'};
    }
    return {tags: ['total_act_energy'], unit: 'kWh'};
}

interface Slot {
    bucket: string;
    key: string;
    label: string;
    unit: string;
    value: number;
}

export function groupMeterRows(
    meterRows: ReadonlyArray<EnergyQueryRow>,
    meters: ReadonlyArray<EnergyLogicalMeter>,
    opts: {
        dimension: EnergyGroupDimension;
        totals: boolean;
        // Include formula meters as their own series. Only valid for the
        // 'meter' dimension; aggregate dimensions (role/kind/utility) must
        // keep excluding them or a virtual meter double-counts its inputs.
        includeFormula?: boolean;
    }
): EnergyGroupRow[] {
    const included = indexMeters(meters, opts.includeFormula ?? false);
    const perMeterBucket = collectPerMeterBucket(meterRows, included);
    const outBucket = opts.totals ? earliestBucket(perMeterBucket) : undefined;
    const slots = foldIntoDimension(
        perMeterBucket,
        included,
        opts.dimension,
        outBucket
    );
    return sortRows(toRows(slots, opts.dimension));
}

// Formula meters are derived, so the report and the aggregate dimensions
// exclude them (a virtual meter would double-count its inputs). The live
// 'meter' dimension opts back in via includeFormula — a formula meter is a
// legitimate standalone series there.
function indexMeters(
    meters: ReadonlyArray<EnergyLogicalMeter>,
    includeFormula: boolean
): Map<number, EnergyLogicalMeter> {
    const index = new Map<number, EnergyLogicalMeter>();
    for (const meter of meters) {
        if (!includeFormula && meter.aggregationMode === 'formula') continue;
        index.set(meter.id, meter);
    }
    return index;
}

interface MeterBucket {
    meterId: number;
    bucket: string;
    byTag: Map<string, number>;
}

function collectPerMeterBucket(
    rows: ReadonlyArray<EnergyQueryRow>,
    included: ReadonlyMap<number, EnergyLogicalMeter>
): MeterBucket[] {
    const index = new Map<string, MeterBucket>();
    for (const row of rows) {
        if (row.meterId === undefined || !included.has(row.meterId)) continue;
        const key = `${row.meterId}|${row.bucket}`;
        const entry = index.get(key) ?? {
            meterId: row.meterId,
            bucket: row.bucket,
            byTag: new Map<string, number>()
        };
        entry.byTag.set(row.tag, (entry.byTag.get(row.tag) ?? 0) + row.value);
        index.set(key, entry);
    }
    return [...index.values()];
}

function earliestBucket(entries: ReadonlyArray<MeterBucket>): string {
    let earliest: string | undefined;
    for (const e of entries) {
        if (earliest === undefined || e.bucket < earliest) earliest = e.bucket;
    }
    return earliest ?? '';
}

function foldIntoDimension(
    entries: ReadonlyArray<MeterBucket>,
    included: ReadonlyMap<number, EnergyLogicalMeter>,
    dimension: EnergyGroupDimension,
    totalsBucket: string | undefined
): Map<string, Slot> {
    const slots = new Map<string, Slot>();
    for (const entry of entries) {
        const meter = included.get(entry.meterId);
        if (!meter) continue;
        const metric = meterMetric(meter.utilityType);
        const value = firstTagValue(entry.byTag, metric.tags);
        if (value === undefined) continue;
        const group = dimensionOf(meter, dimension);
        if (group === null) continue;
        const bucket = totalsBucket ?? entry.bucket;
        addToSlot(slots, bucket, metric.unit, group, value);
    }
    return slots;
}

function firstTagValue(
    byTag: ReadonlyMap<string, number>,
    tags: readonly string[]
): number | undefined {
    for (const tag of tags) {
        const value = byTag.get(tag);
        if (value !== undefined) return value;
    }
    return undefined;
}

// Null means "this meter has no value on this dimension" (a meter with no
// kindId under a kind grouping); it drops out rather than forming an empty
// group — matching the report's sumBy, which skips the null label.
function dimensionOf(
    meter: EnergyLogicalMeter,
    dimension: EnergyGroupDimension
): {key: string; label: string} | null {
    if (dimension === 'meter') {
        return {key: String(meter.id), label: meter.name};
    }
    if (dimension === 'role') return {key: meter.role, label: meter.role};
    if (dimension === 'utility') {
        return {key: meter.utilityType, label: meter.utilityType};
    }
    if (!meter.kindId) return null;
    return {key: meter.kindId, label: meter.kindId};
}

function addToSlot(
    slots: Map<string, Slot>,
    bucket: string,
    unit: string,
    group: {key: string; label: string},
    value: number
): void {
    const slotKey = `${bucket}|${unit}|${group.key}`;
    const slot = slots.get(slotKey);
    if (slot) {
        slot.value += value;
        return;
    }
    slots.set(slotKey, {
        bucket,
        key: group.key,
        label: group.label,
        unit,
        value
    });
}

function toRows(
    slots: ReadonlyMap<string, Slot>,
    dimension: EnergyGroupDimension
): EnergyGroupRow[] {
    return [...slots.values()].map((s) => ({
        bucket: s.bucket,
        groupBy: dimension,
        key: s.key,
        label: s.label,
        unit: s.unit,
        value: s.value
    }));
}

// Bucket ascending (chart x-axis), then value descending (biggest series
// first, matching the report's per-group ordering).
function sortRows(rows: EnergyGroupRow[]): EnergyGroupRow[] {
    return rows.sort((a, b) => {
        if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
        return b.value - a.value;
    });
}
