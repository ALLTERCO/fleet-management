// Fleet-intensive measured values (PF, voltage): avg + min/max. Only quantities
// that aggregate meaningfully across phases/devices — current/power are
// extensive and per-device, shown in the phase-analysis section instead.

import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';

export interface MetricStat {
    avg: number | null;
    min: number | null;
    max: number | null;
}

export interface MeasuredMetrics {
    powerFactor: MetricStat | null;
    voltage: MetricStat | null;
}

// Tags this section reads — also the repository query's tag list.
export const MEASURED_METRIC_TAGS = ['power_factor', 'voltage'] as const;

type RawStats = ReadonlyMap<string, MetricStat>;

// No data is absent, not zero — never invent an unmeasured value.
function stat(raw: RawStats, tag: string): MetricStat | null {
    const s = raw.get(tag);
    if (!s || s.avg === null) return null;
    return {avg: s.avg, min: s.min, max: s.max};
}

export function computeMeasuredMetrics(raw: RawStats): MeasuredMetrics {
    return {
        powerFactor: stat(raw, 'power_factor'),
        voltage: stat(raw, 'voltage')
    };
}

function measuredRow(label: string, notes: string): EnergyReportRow {
    return energyRow({device: label, notes});
}

function fmtStat(s: MetricStat, unit: string, dp: number): string {
    const u = unit ? ` ${unit}` : '';
    const f = (v: number | null) => (v === null ? '—' : v.toFixed(dp));
    return `avg ${f(s.avg)}${u} (range ${f(s.min)}–${f(s.max)}${u})`;
}

// Renders one row per metric with data; returns false (section skipped) when
// nothing was measured.
export function appendMeasuredSection(req: {
    rows: EnergyReportRow[];
    metrics: MeasuredMetrics;
}): boolean {
    const m = req.metrics;
    if (!m.powerFactor && !m.voltage) return false;
    req.rows.push(measuredRow('ELECTRICAL MEASUREMENTS', ''));
    if (m.powerFactor) {
        req.rows.push(
            measuredRow('Power factor', fmtStat(m.powerFactor, '', 3))
        );
    }
    if (m.voltage) {
        req.rows.push(measuredRow('Voltage', fmtStat(m.voltage, 'V', 1)));
    }
    req.rows.push({...energyRowBlank()});
    return true;
}
