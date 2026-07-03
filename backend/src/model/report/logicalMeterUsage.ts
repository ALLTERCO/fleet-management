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

import type {EnergyGroupRow, EnergyLogicalMeter} from '../../types/api/energy';
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
                    utilityType: meter.utilityType,
                    unit: meterMetric(meter.utilityType).unit,
                    kWh: r.value
                }
            ];
        });
}

function toGroupedUsage(row: EnergyGroupRow): GroupedUsage {
    return {label: row.label, unit: row.unit, value: row.value};
}
