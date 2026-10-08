import type {ReportSectionId} from '../../types/api/reporttemplate';
import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import type {LogicalMeterBreakdown} from './logicalMeterUsage';

export interface EvDeliveredEnergySectionRequest {
    rows: EnergyReportRow[];
    breakdown: LogicalMeterBreakdown | null;
    allowedSections?: readonly ReportSectionId[] | null;
}

/**
 * Reports interval-meter energy attributed to the explicit ev_charge role.
 * This is intentionally not a session model: it has no driver, authorization,
 * start/stop register, parking time, OCPP transaction or billable CDR.
 */
export function appendEvDeliveredEnergySection(
    request: EvDeliveredEnergySectionRequest
): ReportSectionId | null {
    if (
        request.allowedSections?.length &&
        !request.allowedSections.includes('ev')
    ) {
        return null;
    }
    const meters = (request.breakdown?.perMeter ?? []).filter(
        (meter) =>
            meter.role === 'ev_charge' &&
            meter.utilityType === 'electric' &&
            meter.unit === 'kWh' &&
            meter.kWh > 0
    );
    if (meters.length === 0) return null;

    request.rows.push(row({section: 'EV CHARGING — DERIVED DELIVERED ENERGY'}));
    request.rows.push(
        row({
            device: 'Delivered energy total',
            consumption_kwh: +meters
                .reduce((sum, meter) => sum + meter.kWh, 0)
                .toFixed(3),
            notes: 'Derived from interval energy assigned to logical meters with role ev_charge. Not a billable charge session: no vehicle, driver, authorization, session boundary, start/stop register, parking time or OCPP transaction is inferred.'
        })
    );
    for (const meter of meters.sort((left, right) =>
        left.name.localeCompare(right.name)
    )) {
        request.rows.push(
            row({
                device: meter.name,
                consumption_kwh: +meter.kWh.toFixed(3),
                notes: `Logical meter ${meter.meterId} · ${meter.currentType ?? 'current type unknown'} · ${meter.balancePosition}`
            })
        );
    }
    request.rows.push({...energyRowBlank()});
    return 'ev';
}

function row(fields: Partial<EnergyReportRow>): EnergyReportRow {
    return energyRow(fields);
}
