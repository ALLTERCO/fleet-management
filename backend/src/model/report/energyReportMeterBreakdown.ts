// "Reports query logical meters" — rendering layer. buildMeterBreakdown reads
// the org's logical meters + channel-grain energy for the report window and
// attributes it per meter (pure logic in logicalMeterUsage). appendMeter-
// BreakdownSection formats that into report rows: per meter, by role, by
// equipment (kindId), and by utility. Best-effort like the PV section — a meter
// read failure drops only this section, never the whole report.

import {getLogger} from 'log4js';
import {
    listLogicalMeterMeanings,
    listLogicalMeters
} from '../../modules/repositories/LogicalMeterRepository';
import {queryLogicalChannelEnergyByBucket} from '../../modules/virtualDevice/logicalEnergy';
import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import {
    type GroupedUsage,
    type LogicalMeterBreakdown,
    logicalMeterBreakdownWithHistory
} from './logicalMeterUsage';

const logger = getLogger('energyReportMeterBreakdown');

// Additive meter counters. Electric uses consumption, gas meters can represent
// either import or explicitly metered return, water uses volume, and heat uses
// thermal kWh; logicalMeterUsage picks the right tag per utility.
const METER_BREAKDOWN_TAGS = [
    'total_act_energy',
    'volume_l',
    'volume_m3',
    'volume_returned_m3',
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
        const [meters, meanings] = await Promise.all([
            listLogicalMeters(req.orgId, undefined, undefined, req.from),
            listLogicalMeterMeanings(req.orgId, req.from, req.to)
        ]);
        if (meters.length === 0) return null;
        const rows = await queryLogicalChannelEnergyByBucket({
            internalIds: req.internalIds,
            from: req.from,
            to: req.to,
            tags: METER_BREAKDOWN_TAGS
        });
        const breakdown = logicalMeterBreakdownWithHistory(
            meters,
            meanings,
            rows
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
        req.rows.push(labelledRow(m.name, m.kWh, meterNotes(m)));
    }
    appendGroupRows(req.rows, 'BY ROLE', breakdown.byRole);
    appendGroupRows(req.rows, 'BY END USE', breakdown.byKind);
    appendGroupRows(req.rows, 'BY UTILITY', breakdown.byUtility);
    req.rows.push({...energyRowBlank()});
    return 'meter_breakdown';
}

function meterNotes(meter: LogicalMeterBreakdown['perMeter'][number]): string {
    const axes = [
        meter.utilityType,
        meter.role,
        meter.unit,
        meter.currentType,
        meter.energySource,
        meter.balancePosition
    ];
    return axes.filter((value) => value != null).join(' · ');
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
