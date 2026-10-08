// "Reports query logical meters" (the doc's payoff), data layer. Turns a set
// of logical meters + channel-grain energy into per-meter totals and the three
// breakdowns reports want: by role (energy by source), by kindId (by
// appliance/equipment) and by utilityType.
//
// Grouping is NOT reimplemented here: it delegates to the shared bucket-aware
// grouper (energy/meterGrouping) that the live Energy.Query group-by also uses,
// so the report breakdown and the live chart can never drift. This layer only
// attributes channel energy to meters (meterQuery), collapses to a window total,
// and adapts the grouper's rows into the report's MeterUsage/GroupedUsage shapes.

import type {
    EnergyGroupRow,
    EnergyLogicalMeter,
    EnergyLogicalMeterMeaning
} from '../../types/api/energy';
import {groupMeterRows, meterMetric} from '../energy/meterGrouping';
import {
    attributeMeterEnergy,
    type ChannelEnergyRow
} from '../energy/meterQuery';

export interface MeterUsage {
    meterId: number;
    name: string;
    role: string;
    kindId: string | null;
    energySource: string | null;
    currentType: string | null;
    balancePosition: string;
    utilityType: string;
    unit: string;
    kWh: number;
}

// One grouped total. `unit` is carried because a role/kind can span utilities
// of different units (e.g. electric kWh and water volume both tagged 'aux').
export interface GroupedUsage {
    label: string;
    unit: string;
    value: number;
}

export interface LogicalMeterBreakdown {
    perMeter: MeterUsage[];
    byRole: GroupedUsage[];
    byKind: GroupedUsage[];
    byUtility: GroupedUsage[];
}

// Sum each meter's energy over the window, then group. '1 day' is the coarsest
// bucket the attribution supports and is enough since the grouper re-totals in
// `totals` mode anyway.
export function logicalMeterBreakdown(
    meters: ReadonlyArray<EnergyLogicalMeter>,
    channelRows: ReadonlyArray<ChannelEnergyRow>
): LogicalMeterBreakdown {
    const meterRows = attributeMeterEnergy(
        toPointSets(meters),
        channelRows,
        '1 day'
    );
    const group = (dimension: 'role' | 'kind' | 'utility') =>
        groupMeterRows(meterRows, meters, {dimension, totals: true})
            .filter((r) => r.value > 0)
            .map(toGroupedUsage);
    return {
        perMeter: perMeterUsage(meterRows, meters),
        byRole: group('role'),
        byKind: group('kind'),
        byUtility: group('utility')
    };
}

/**
 * Resolve role/end-use in each half-open meaning window before grouping. The
 * raw 15-minute series is read once, then partitioned only at version
 * boundaries; a later role edit cannot move older report energy into today's
 * classification.
 */
export function logicalMeterBreakdownWithHistory(
    meters: ReadonlyArray<EnergyLogicalMeter>,
    meanings: ReadonlyArray<EnergyLogicalMeterMeaning>,
    channelRows: ReadonlyArray<ChannelEnergyRow>
): LogicalMeterBreakdown {
    const history = meaningsByMeter(meanings);
    const rowsByWindow = groupChannelRowsByMeaningWindow(channelRows, meanings);
    const parts = [...rowsByWindow.values()].map((rows) =>
        logicalMeterBreakdown(
            meters.map((meter) =>
                meaningAt(meter, history.get(meter.id), rows[0].bucket)
            ),
            rows
        )
    );
    return mergeBreakdowns(parts);
}

function meaningsByMeter(
    meanings: ReadonlyArray<EnergyLogicalMeterMeaning>
): Map<number, EnergyLogicalMeterMeaning[]> {
    const byMeter = new Map<number, EnergyLogicalMeterMeaning[]>();
    for (const meaning of meanings) {
        const versions = byMeter.get(meaning.meterId) ?? [];
        versions.push(meaning);
        byMeter.set(meaning.meterId, versions);
    }
    for (const versions of byMeter.values()) {
        versions.sort((left, right) => startMs(left) - startMs(right));
    }
    return byMeter;
}

function meaningAt(
    meter: EnergyLogicalMeter,
    history: readonly EnergyLogicalMeterMeaning[] | undefined,
    bucket: string
): EnergyLogicalMeter {
    const at = new Date(bucket).getTime();
    const meaning = findMeaningAt(history, at);
    return meaning
        ? {
              ...meter,
              role: meaning.role,
              kindId: meaning.kindId,
              meaningRevision: meaning.revision,
              meaningEffectiveFrom: meaning.effectiveFrom
          }
        : meter;
}

function findMeaningAt(
    history: readonly EnergyLogicalMeterMeaning[] | undefined,
    at: number
): EnergyLogicalMeterMeaning | undefined {
    if (!history) return undefined;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const version = history[index];
        const from = startMs(version);
        const to = version.effectiveTo
            ? new Date(version.effectiveTo).getTime()
            : Number.POSITIVE_INFINITY;
        if (from <= at && at < to) return version;
    }
    return undefined;
}

function groupChannelRowsByMeaningWindow(
    rows: ReadonlyArray<ChannelEnergyRow>,
    meanings: ReadonlyArray<EnergyLogicalMeterMeaning>
): Map<string, ChannelEnergyRow[]> {
    const boundaries = meaningBoundaries(meanings);
    const grouped = new Map<string, ChannelEnergyRow[]>();
    for (const row of rows) {
        const window = windowStart(new Date(row.bucket).getTime(), boundaries);
        const windowRows = grouped.get(window) ?? [];
        windowRows.push(row);
        grouped.set(window, windowRows);
    }
    return grouped;
}

function meaningBoundaries(
    meanings: ReadonlyArray<EnergyLogicalMeterMeaning>
): number[] {
    const boundaries = new Set<number>();
    for (const meaning of meanings) {
        if (meaning.effectiveFrom) {
            boundaries.add(new Date(meaning.effectiveFrom).getTime());
        }
        if (meaning.effectiveTo) {
            boundaries.add(new Date(meaning.effectiveTo).getTime());
        }
    }
    return [...boundaries].sort((left, right) => left - right);
}

function windowStart(at: number, boundaries: readonly number[]): string {
    let low = 0;
    let high = boundaries.length - 1;
    let found = Number.NEGATIVE_INFINITY;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (boundaries[middle] <= at) {
            found = boundaries[middle];
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return String(found);
}

function startMs(meaning: EnergyLogicalMeterMeaning): number {
    return meaning.effectiveFrom
        ? new Date(meaning.effectiveFrom).getTime()
        : Number.NEGATIVE_INFINITY;
}

function mergeBreakdowns(
    parts: readonly LogicalMeterBreakdown[]
): LogicalMeterBreakdown {
    return {
        perMeter: mergeMeterUsage(parts.flatMap((part) => part.perMeter)),
        byRole: mergeGroupedUsage(parts.flatMap((part) => part.byRole)),
        byKind: mergeGroupedUsage(parts.flatMap((part) => part.byKind)),
        byUtility: mergeGroupedUsage(parts.flatMap((part) => part.byUtility))
    };
}

function mergeMeterUsage(rows: readonly MeterUsage[]): MeterUsage[] {
    const merged = new Map<string, MeterUsage>();
    for (const row of rows) {
        const key = `${row.meterId}|${row.role}|${row.kindId ?? ''}|${row.unit}`;
        const prior = merged.get(key);
        merged.set(
            key,
            prior ? {...prior, kWh: prior.kWh + row.kWh} : {...row}
        );
    }
    return [...merged.values()];
}

function mergeGroupedUsage(rows: readonly GroupedUsage[]): GroupedUsage[] {
    const merged = new Map<string, GroupedUsage>();
    for (const row of rows) {
        const key = `${row.label}|${row.unit}`;
        const prior = merged.get(key);
        merged.set(
            key,
            prior ? {...prior, value: prior.value + row.value} : {...row}
        );
    }
    return [...merged.values()];
}

function toPointSets(meters: ReadonlyArray<EnergyLogicalMeter>) {
    return meters
        .filter((m) => m.aggregationMode !== 'formula')
        .map((m) => ({
            id: m.id,
            points: m.points.map((p) => ({
                deviceId: p.deviceId,
                channel: p.channel,
                tag: p.tag
            }))
        }));
}

// The per-meter list carries richer meaning (role/kind/utility) than a group
// row, so enrich the grouper's 'meter' rows from the meter definitions.
function perMeterUsage(
    meterRows: ReturnType<typeof attributeMeterEnergy>,
    meters: ReadonlyArray<EnergyLogicalMeter>
): MeterUsage[] {
    const byId = new Map(meters.map((m) => [m.id, m]));
    return groupMeterRows(meterRows, meters, {
        dimension: 'meter',
        totals: true
    })
        .filter((r) => r.value > 0)
        .flatMap((r) => {
            const meter = byId.get(Number(r.key));
            if (!meter) return [];
            return [
                {
                    meterId: meter.id,
                    name: meter.name,
                    role: meter.role,
                    kindId: meter.kindId ?? null,
                    energySource: meter.energySource ?? null,
                    currentType: meterCurrentType(meter),
                    balancePosition:
                        meter.balancePosition ?? 'final_consumption',
                    utilityType: meter.utilityType,
                    unit: meterMetric(meter.utilityType).unit,
                    kWh: r.value
                }
            ];
        });
}

function meterCurrentType(meter: EnergyLogicalMeter): string | null {
    const types = new Set(
        meter.points.flatMap((point) =>
            point.currentType == null ? [] : [point.currentType]
        )
    );
    if (types.size === 0) return null;
    if (types.size === 1) return [...types][0];
    return 'mixed';
}

function toGroupedUsage(row: EnergyGroupRow): GroupedUsage {
    return {label: row.label, unit: row.unit, value: row.value};
}
