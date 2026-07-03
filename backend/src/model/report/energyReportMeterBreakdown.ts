// "Reports query logical meters" — rendering layer. buildMeterBreakdown reads
// the org's logical meters + channel-grain energy for the report window and
// attributes it per meter (pure logic in logicalMeterUsage). appendMeter-
// BreakdownSection formats that into report rows: per meter, by role, by
// equipment (kindId), and by utility. Best-effort like the PV section — a meter
// read failure drops only this section, never the whole report.

import {getLogger} from 'log4js';
import {defaultEnergyRepository} from '../../modules/repositories/EnergyRepository';
import {listLogicalMeters} from '../../modules/repositories/LogicalMeterRepository';
import type {ChannelEnergyRow} from '../energy/meterQuery';
import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import {
    type GroupedUsage,
    type LogicalMeterBreakdown,
    logicalMeterBreakdown
} from './logicalMeterUsage';

const logger = getLogger('energyReportMeterBreakdown');

// Additive meter counters. Electric uses consumption, gas/water use volume,
// heat uses thermal kWh; logicalMeterUsage picks the right tag per utility.
const METER_BREAKDOWN_TAGS = [
    'total_act_energy',
    'volume_l',
    'volume_m3',
    'thermal_energy_kwh'
] as const;

export interface BuildMeterBreakdownRequest {
    orgId: string;
    internalIds: readonly number[];
    from: Date;
    to: Date;
}

export async function buildMeterBreakdown(
    req: BuildMeterBreakdownRequest
): Promise<LogicalMeterBreakdown | null> {
    if (req.internalIds.length === 0) return null;
    try {
        const meters = await listLogicalMeters(req.orgId);
        if (meters.length === 0) return null;
        const repo = await defaultEnergyRepository();
        const totals = await repo.queryChannelEnergyTotals({
            internalIds: req.internalIds,
            from: req.from,
            to: req.to,
            tags: METER_BREAKDOWN_TAGS
        });
        const breakdown = logicalMeterBreakdown(
            meters,
            toChannelRows(totals, req.from)
        );
        return breakdown.perMeter.length > 0 ? breakdown : null;
    } catch (err) {
        logger.warn(
            'meter breakdown read failed for org %s (section skipped): %s',
            req.orgId,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

// Channel totals carry no bucket; the breakdown re-totals anyway, so stamp one
// synthetic bucket (the window start) and fold null channels to 0 — the point
// default the save path also uses.
function toChannelRows(
    totals: ReadonlyArray<{
        device: number;
        channel: number | null;
        tag: string;
        totalWh: number;
    }>,
    from: Date
): ChannelEnergyRow[] {
    const bucket = from.toISOString();
    return totals.map((t) => ({
        bucket,
        device: t.device,
        channel: t.channel ?? 0,
        tag: t.tag,
        energy_wh: t.totalWh
    }));
}

export interface MeterBreakdownSectionRequest {
    rows: EnergyReportRow[];
    breakdown: LogicalMeterBreakdown | null;
}

// Returns the section id when it rendered (for report metadata), else null.
export function appendMeterBreakdownSection(
    req: MeterBreakdownSectionRequest
): string | null {
    const breakdown = req.breakdown;
    if (!breakdown || breakdown.perMeter.length === 0) return null;
    req.rows.push(headerRow('ENERGY BY METER'));
    for (const m of breakdown.perMeter) {
        req.rows.push(
            labelledRow(
                m.name,
                m.kWh,
                `${m.utilityType} · ${m.role} · ${m.unit}`
            )
        );
    }
    appendGroupRows(req.rows, 'BY ROLE', breakdown.byRole);
    appendGroupRows(req.rows, 'BY EQUIPMENT', breakdown.byKind);
    appendGroupRows(req.rows, 'BY UTILITY', breakdown.byUtility);
    req.rows.push({...energyRowBlank()});
    return 'meter_breakdown';
}

function appendGroupRows(
    rows: EnergyReportRow[],
    title: string,
    group: ReadonlyArray<GroupedUsage>
): void {
    if (group.length === 0) return;
    rows.push(headerRow(title));
    for (const g of [...group].sort((a, b) => b.value - a.value)) {
        rows.push(labelledRow(g.label, g.value, g.unit));
    }
}

function headerRow(title: string): EnergyReportRow {
    return blankCols({section: title});
}

function labelledRow(
    label: string,
    kWh: number,
    notes: string
): EnergyReportRow {
    return blankCols({device: label, consumption: +kWh.toFixed(3), notes});
}

// Maps this section's friendly field names onto the report row's columns.
function blankCols(fields: {
    section?: string;
    device?: string;
    consumption?: number;
    notes?: string;
}): EnergyReportRow {
    return energyRow({
        section: fields.section ?? '',
        device: fields.device ?? '',
        consumption_kwh: fields.consumption ?? '',
        notes: fields.notes ?? ''
    });
}
