// Peak hour-of-day: the hour using the most, averaged per day.

import {HOURS_PER_DAY} from '../../modules/util/timeUnits';
import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';

export interface PeakHour {
    hour: number;
    totalKWh: number;
    avgKWh: number;
}

function round3(value: number): number {
    return +value.toFixed(3);
}

// consumedKWh holds total kWh per hour-of-day over the whole window.
export function computePeakHour(
    consumedKWh: readonly number[],
    periodDays: number
): PeakHour | null {
    if (consumedKWh.length !== HOURS_PER_DAY) return null;
    let hour = -1;
    let total = 0;
    for (let h = 0; h < HOURS_PER_DAY; h++) {
        if (consumedKWh[h] > total) {
            total = consumedKWh[h];
            hour = h;
        }
    }
    if (hour < 0) return null;
    // Clamp to >=1 day so a sub-day window never inflates the per-day figure.
    const days = Math.max(1, periodDays);
    return {hour, totalKWh: round3(total), avgKWh: round3(total / days)};
}

function profileRow(label: string, notes: string): EnergyReportRow {
    return energyRow({device: label, notes});
}

export function appendUsageProfileSection(req: {
    rows: EnergyReportRow[];
    consumedKWh: readonly number[];
    periodDays: number;
}): boolean {
    const peak = computePeakHour(req.consumedKWh, req.periodDays);
    if (!peak) return false;
    const hh = String(peak.hour).padStart(2, '0');
    req.rows.push(profileRow('USAGE PROFILE', ''));
    req.rows.push(
        profileRow(
            'Peak hour',
            `${hh}:00 — avg ${peak.avgKWh} kWh/day (${peak.totalKWh} kWh total)`
        )
    );
    req.rows.push({...energyRowBlank()});
    return true;
}
