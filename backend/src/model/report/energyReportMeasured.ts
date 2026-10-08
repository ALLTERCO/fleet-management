// Device-reported electrical and battery measurements. Values are shown only
// when the fleet supplied them; derived estimates stay in power quality.

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

/** Energy totals only an EM meter record carries. Null when not reported. */
export interface RecordEnergyTotals {
    lagReactiveVarh: number | null;
    leadReactiveVarh: number | null;
    fundamentalActiveWh: number | null;
    fundamentalReturnedWh: number | null;
}

export interface MeasuredMetrics {
    powerFactor: MetricStat | null;
    voltage: MetricStat | null;
    apparentPower?: MetricStat | null;
    totalPower?: MetricStat | null;
    totalApparentPower?: MetricStat | null;
    totalCurrent?: MetricStat | null;
    neutralCurrent?: MetricStat | null;
    stateOfCharge?: MetricStat | null;
    stateOfHealth?: MetricStat | null;
    cycles?: MetricStat | null;
    chargeAh?: MetricStat | null;
    dischargeAh?: MetricStat | null;
    recordEnergy?: RecordEnergyTotals | null;
}

export const ELECTRICAL_MEASURED_METRIC_TAGS = [
    'voltage',
    'power_factor',
    'apparent_power',
    'total_power',
    'total_apparent_power',
    'total_current',
    'neutral_current'
] as const;

/** Tags only an EM meter record carries: energy totals and minute extremes. */
export const ELECTRICAL_RECORD_METRIC_TAGS = [
    'lag_react_energy',
    'lead_react_energy',
    'fund_act_energy',
    'fund_act_ret_energy',
    'min_apparent_power',
    'max_apparent_power',
    'min_neutral_current',
    'max_neutral_current'
] as const;

export const BATTERY_MEASURED_METRIC_TAGS = [
    'soc',
    'soh',
    'cycles',
    'charge_ah',
    'discharge_ah'
] as const;

/** A reading's stat; `total` is its sum, kept for energy tags. */
export type RawStat = MetricStat & {total?: number | null};
type RawStats = ReadonlyMap<string, RawStat>;

// No data is absent, not zero — never invent an unmeasured value.
function stat(raw: RawStats, tag: string): MetricStat | null {
    const s = raw.get(tag);
    if (!s || s.avg === null) return null;
    return {avg: s.avg, min: s.min, max: s.max};
}

export function computeMeasuredMetrics(raw: RawStats): MeasuredMetrics {
    return {
        powerFactor: stat(raw, 'power_factor'),
        voltage: stat(raw, 'voltage'),
        apparentPower: withMeterRange(raw, {
            tag: 'apparent_power',
            minTag: 'min_apparent_power',
            maxTag: 'max_apparent_power'
        }),
        totalPower: stat(raw, 'total_power'),
        totalApparentPower: stat(raw, 'total_apparent_power'),
        totalCurrent: stat(raw, 'total_current'),
        neutralCurrent: withMeterRange(raw, {
            tag: 'neutral_current',
            minTag: 'min_neutral_current',
            maxTag: 'max_neutral_current'
        }),
        stateOfCharge: stat(raw, 'soc'),
        stateOfHealth: stat(raw, 'soh'),
        cycles: stat(raw, 'cycles'),
        chargeAh: stat(raw, 'charge_ah'),
        dischargeAh: stat(raw, 'discharge_ah'),
        recordEnergy: recordEnergyTotals(raw)
    };
}

// The meter's own minute extremes are the true range; the average stays the
// reading's own.
function withMeterRange(
    raw: RawStats,
    tags: {tag: string; minTag: string; maxTag: string}
): MetricStat | null {
    const base = stat(raw, tags.tag);
    if (!base) return null;
    return {
        avg: base.avg,
        min: raw.get(tags.minTag)?.min ?? base.min,
        max: raw.get(tags.maxTag)?.max ?? base.max
    };
}

function total(raw: RawStats, tag: string): number | null {
    return raw.get(tag)?.total ?? null;
}

function recordEnergyTotals(raw: RawStats): RecordEnergyTotals | null {
    const totals: RecordEnergyTotals = {
        lagReactiveVarh: total(raw, 'lag_react_energy'),
        leadReactiveVarh: total(raw, 'lead_react_energy'),
        fundamentalActiveWh: total(raw, 'fund_act_energy'),
        fundamentalReturnedWh: total(raw, 'fund_act_ret_energy')
    };
    return Object.values(totals).some((v) => v !== null) ? totals : null;
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
    const electrical = [
        m.powerFactor,
        m.voltage,
        m.apparentPower,
        m.totalPower,
        m.totalApparentPower,
        m.totalCurrent,
        m.neutralCurrent,
        m.recordEnergy
    ];
    const battery = [
        m.stateOfCharge,
        m.stateOfHealth,
        m.cycles,
        m.chargeAh,
        m.dischargeAh
    ];
    if (!electrical.some(Boolean) && !battery.some(Boolean)) return false;
    if (electrical.some(Boolean)) {
        appendElectricalRows(req.rows, m);
    }
    if (battery.some(Boolean)) {
        appendBatteryRows(req.rows, m);
    }
    req.rows.push({...energyRowBlank()});
    return true;
}

function appendElectricalRows(
    rows: EnergyReportRow[],
    metrics: MeasuredMetrics
): void {
    const m = metrics;
    rows.push(measuredRow('ELECTRICAL MEASUREMENTS', ''));
    if (m.powerFactor) {
        rows.push(measuredRow('Power factor', fmtStat(m.powerFactor, '', 3)));
    }
    if (m.voltage) {
        rows.push(measuredRow('Voltage', fmtStat(m.voltage, 'V', 1)));
    }
    appendStat(rows, 'Apparent power', m.apparentPower ?? null, 'VA', 1);
    appendStat(rows, 'Total power', m.totalPower ?? null, 'W', 1);
    appendStat(
        rows,
        'Total apparent power',
        m.totalApparentPower ?? null,
        'VA',
        1
    );
    appendStat(rows, 'Total current', m.totalCurrent ?? null, 'A', 3);
    appendStat(rows, 'Neutral current', m.neutralCurrent ?? null, 'A', 3);
    appendRecordEnergyRows(rows, m.recordEnergy ?? null);
}

function appendRecordEnergyRows(
    rows: EnergyReportRow[],
    totals: RecordEnergyTotals | null
): void {
    if (!totals) return;
    const lines: ReadonlyArray<EnergyTotalLine> = [
        {
            label: 'Reactive energy, lagging',
            value: totals.lagReactiveVarh,
            unit: 'kvarh'
        },
        {
            label: 'Reactive energy, leading',
            value: totals.leadReactiveVarh,
            unit: 'kvarh'
        },
        {
            label: 'Fundamental active energy',
            value: totals.fundamentalActiveWh,
            unit: 'kWh'
        },
        {
            label: 'Fundamental returned energy',
            value: totals.fundamentalReturnedWh,
            unit: 'kWh'
        }
    ];
    for (const line of lines) appendTotal(rows, line);
}

interface EnergyTotalLine {
    label: string;
    value: number | null;
    unit: string;
}

// Stored in Wh / VARh; printed in thousands like every other energy row.
function appendTotal(rows: EnergyReportRow[], line: EnergyTotalLine): void {
    if (line.value === null) return;
    rows.push(
        measuredRow(
            line.label,
            `${(line.value / 1000).toFixed(3)} ${line.unit}`
        )
    );
}

function appendBatteryRows(
    rows: EnergyReportRow[],
    metrics: MeasuredMetrics
): void {
    rows.push(measuredRow('BATTERY MEASUREMENTS', ''));
    appendStat(rows, 'State of charge', metrics.stateOfCharge ?? null, '%', 1);
    appendStat(rows, 'State of health', metrics.stateOfHealth ?? null, '%', 1);
    appendStat(rows, 'Cycles', metrics.cycles ?? null, '', 1);
    appendStat(rows, 'Charge counter', metrics.chargeAh ?? null, 'Ah', 2);
    appendStat(rows, 'Discharge counter', metrics.dischargeAh ?? null, 'Ah', 2);
}

function appendStat(
    rows: EnergyReportRow[],
    label: string,
    stat: MetricStat | null,
    unit: string,
    digits: number
): void {
    if (stat) rows.push(measuredRow(label, fmtStat(stat, unit, digits)));
}
