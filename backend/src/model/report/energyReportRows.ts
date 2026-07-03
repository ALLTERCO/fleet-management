import type {PhaseGroup} from './anomalies';
import {splitByDayOfWeek} from './dayOfWeekSplit';
import {
    chooseLoadDurationBands,
    energyRow,
    energyRowBlank,
    parseHourlySample,
    phaseImbalancePct
} from './energyEngineHelpers';
import {deviceDisplayName} from './engineHelpers';
import {buildLoadDurationCurve} from './loadDurationCurve';
import {computeDelta, formatDeltaPct} from './periodDeltas';

type ReportRow = Record<string, any>;

type EnergyRowBuilder = typeof energyRow;
type ReportRowSink = ReportRow[] & {
    write?: (row: ReportRow) => Promise<void>;
};

interface TopConsumerRow {
    deviceId: number;
    device: string;
    cons: number;
    ret: number;
    cost: number;
    avgPower: number;
    avgVolt: number;
    avgCurr: number;
    type: string;
}

interface TopConsumersSectionRequest {
    rows: ReportRow[];
    topConsumers: readonly TopConsumerRow[];
    priorConsByDevice: ReadonlyMap<number, number>;
    totalCons: number;
    currencySymbol: string;
}

interface TimeSeriesSectionRequest {
    rows: ReportRowSink;
    tsRows: readonly ReportRow[];
    currencySymbol: string;
}

interface PhaseAnalysisSectionRequest {
    rows: ReportRowSink;
    phaseRows: readonly ReportRow[];
    phaseGroups: ReadonlyMap<string, PhaseGroup>;
}

interface CostAnalysisSectionRequest {
    rows: ReportRow[];
    tariffMode: string;
    dayStart: string;
    dayEnd: string;
    dayCons: number;
    nightCons: number;
    dayCost: number;
    nightCost: number;
    totalCons: number;
    totalCost: number;
    currencySymbol: string;
    touShift: {shiftedKWh: number; savings: number};
    touShiftableFraction: number;
}

interface DataQualitySectionRequest {
    rows: ReportRow[];
    dataQuality: {
        overall: number;
        expectedBucketsPerDevice: number;
        perDevice: ReadonlyMap<number, number>;
    };
    deviceMap: Map<number, string>;
}

interface AnomalySectionRequest {
    rows: ReportRow[];
    anomalies: readonly {
        device: string;
        type: string;
        value: string | number;
        threshold: string | number;
        description: string;
    }[];
}

interface DayOfWeekSectionRequest {
    rows: ReportRow[];
    tsRows: readonly ReportRow[];
    timezone: string | null;
}

interface LoadDurationSectionRequest {
    rows: ReportRow[];
    tsRows: readonly ReportRow[];
    peakPower: number;
}

export function appendTopConsumersSection(
    request: TopConsumersSectionRequest
): void {
    const R = energyRow;
    request.rows.push(sectionHeader(R, 'DEVICES'));
    for (const consumer of request.topConsumers) {
        request.rows.push(topConsumerRow(request, consumer));
    }
    appendSeparator(request.rows);
}

function topConsumerRow(
    request: TopConsumersSectionRequest,
    consumer: TopConsumerRow
): ReportRow {
    const share =
        request.totalCons > 0
            ? Math.round((consumer.cons / request.totalCons) * 100)
            : 0;
    const priorCons = request.priorConsByDevice.get(consumer.deviceId) ?? null;
    const devDeltaPct = formatDeltaPct(
        computeDelta(
            consumer.cons,
            priorCons && priorCons > 0 ? priorCons : null
        ).deltaPct
    );
    return energyRow({
        device: consumer.device,
        consumption_kwh: +consumer.cons.toFixed(3),
        returned_kwh: +consumer.ret.toFixed(3),
        net_kwh: +(consumer.cons - consumer.ret).toFixed(3),
        cost: `${request.currencySymbol}${consumer.cost.toFixed(2)}`,
        power_w: +consumer.avgPower.toFixed(0),
        voltage_v: +consumer.avgVolt.toFixed(1),
        current_a: +consumer.avgCurr.toFixed(3),
        share_pct: `${share}%`,
        delta_pct: devDeltaPct,
        notes: consumer.type
    });
}

export async function appendTimeSeriesSection(
    request: TimeSeriesSectionRequest
): Promise<void> {
    const R = energyRow;
    await writeReportRow(request.rows, sectionHeader(R, 'TIME-SERIES'));
    for (const row of request.tsRows) {
        await writeReportRow(
            request.rows,
            R({
                date: row.date,
                device: row.device,
                consumption_kwh: row.consumption_kwh,
                returned_kwh: row.returned_kwh,
                net_kwh: row.net_kwh,
                cost: `${request.currencySymbol}${row.cost}`,
                power_w: row.power_avg_w,
                voltage_v: row.voltage_avg_v,
                voltage_min_v: row.voltage_min_v,
                voltage_max_v: row.voltage_max_v,
                current_a: row.current_avg_a,
                current_max_a: row.current_max_a
            })
        );
    }
    await writeReportRow(request.rows, {...energyRowBlank()});
}

export async function appendPhaseAnalysisSection(
    request: PhaseAnalysisSectionRequest
): Promise<void> {
    if (request.phaseRows.length === 0) return;
    const R = energyRow;
    await writeReportRow(request.rows, sectionHeader(R, '3-PHASE'));
    for (const row of request.phaseRows) {
        await writeReportRow(
            request.rows,
            phaseAnalysisRow(request.phaseGroups, row)
        );
    }
    await writeReportRow(request.rows, {...energyRowBlank()});
}

function phaseAnalysisRow(
    phaseGroups: ReadonlyMap<string, PhaseGroup>,
    row: ReportRow
): ReportRow {
    const imbalance =
        row.phase === 'L1'
            ? phaseImbalancePct(phaseGroups.get(`${row.date}::${row.device}`))
            : '';
    return energyRow({
        date: row.date,
        device: row.device,
        phase: row.phase,
        consumption_kwh: row.consumption_kwh,
        power_w: row.power_w,
        voltage_v: row.voltage_v,
        current_a: row.current_a,
        imbalance_pct: imbalance
    });
}

export function appendCostAnalysisSections(
    request: CostAnalysisSectionRequest
): void {
    if (request.tariffMode === 'day_night') {
        appendDayNightCostSection(request);
    }
    if (request.tariffMode === 'tou' && request.totalCost > 0) {
        appendTouCostSection(request);
    }
    appendOpportunitySection(request);
}

export function appendDataQualitySection(
    request: DataQualitySectionRequest
): void {
    if (request.dataQuality.overall >= 0.9) return;
    const qualityPct = Math.round(request.dataQuality.overall * 100);
    request.rows.push(
        energyRow({
            section: 'DATA_QUALITY',
            device: `Fleet ${qualityPct}%`,
            notes: `${request.dataQuality.expectedBucketsPerDevice} buckets expected per device`
        })
    );
    for (const [deviceId, score] of request.dataQuality.perDevice) {
        if (score >= 0.9) continue;
        request.rows.push(
            dataQualityDeviceRow({
                request,
                deviceId,
                score
            })
        );
    }
    appendSeparator(request.rows);
}

function dataQualityDeviceRow(input: {
    request: DataQualitySectionRequest;
    deviceId: number;
    score: number;
}): ReportRow {
    return energyRow({
        device: deviceDisplayName(input.deviceId, input.request.deviceMap),
        share_pct: `${Math.round(input.score * 100)}%`,
        notes: input.score === 0 ? 'No data' : 'Gaps in time series'
    });
}

export function appendAnomalySection(request: AnomalySectionRequest): void {
    if (request.anomalies.length === 0) return;
    request.rows.push(sectionHeader(energyRow, 'ANOMALIES'));
    for (const anomaly of request.anomalies) {
        request.rows.push(anomalyRow(anomaly));
    }
    appendSeparator(request.rows);
}

function anomalyRow(anomaly: AnomalySectionRequest['anomalies'][number]) {
    return energyRow({
        device: anomaly.device,
        voltage_v:
            anomaly.type === 'voltage_low' || anomaly.type === 'voltage_high'
                ? anomaly.value
                : '',
        imbalance_pct: anomaly.type === 'phase_imbalance' ? anomaly.value : '',
        notes: `${anomaly.type}: ${anomaly.description} (threshold: ${anomaly.threshold})`
    });
}

export function appendDayOfWeekSection(request: DayOfWeekSectionRequest): void {
    const samples = request.tsRows
        .map((row) => parseHourlySample(row))
        .filter((sample): sample is {hour: Date; kWh: number} => {
            return sample !== null;
        });
    if (samples.length === 0) return;
    const split = splitByDayOfWeek(samples, request.timezone);
    request.rows.push(
        energyRow({
            section: 'WEEKDAY/WEEKEND',
            device: 'Weekday',
            consumption_kwh: split.weekdayKWh,
            share_pct: `${split.weekdayPct}%`,
            notes: 'Mon–Fri'
        }),
        energyRow({
            section: 'WEEKDAY/WEEKEND',
            device: 'Weekend',
            consumption_kwh: split.weekendKWh,
            share_pct: `${split.weekendPct}%`,
            notes: 'Sat–Sun'
        })
    );
}

export function appendLoadDurationSection(
    request: LoadDurationSectionRequest
): void {
    const samples = request.tsRows
        .map((row) =>
            typeof row.power_avg_w === 'number' ? row.power_avg_w / 1000 : null
        )
        .filter((value): value is number => value !== null);
    if (samples.length === 0) return;
    const curve = buildLoadDurationCurve({
        hourlyPowerKW: samples,
        bandLowerEdgesKW: chooseLoadDurationBands(request.peakPower / 1000)
    });
    for (const band of curve) {
        if (band.hours === 0) continue;
        request.rows.push(loadDurationRow(band));
    }
}

function loadDurationRow(band: {
    fromKW: number;
    toKW: number | null;
    sharePct: number;
    hours: number;
}): ReportRow {
    const label =
        band.toKW === null
            ? `≥${band.fromKW.toFixed(1)} kW`
            : `${band.fromKW.toFixed(1)}–${band.toKW.toFixed(1)} kW`;
    return energyRow({
        section: 'LOAD_DURATION',
        device: label,
        share_pct: `${band.sharePct}%`,
        notes: `${band.hours}h in band`
    });
}

function appendDayNightCostSection(request: CostAnalysisSectionRequest): void {
    const R = energyRow;
    const dayPct =
        request.totalCons > 0
            ? Math.round((request.dayCons / request.totalCons) * 100)
            : 0;
    request.rows.push(sectionHeader(R, 'COST'));
    request.rows.push(
        costRow(R, {
            label: `Day (${request.dayStart.slice(0, 5)}-${request.dayEnd.slice(0, 5)})`,
            kWh: request.dayCons,
            cost: request.dayCost,
            share: `${dayPct}%`,
            currencySymbol: request.currencySymbol
        }),
        costRow(R, {
            label: `Night (${request.dayEnd.slice(0, 5)}-${request.dayStart.slice(0, 5)})`,
            kWh: request.nightCons,
            cost: request.nightCost,
            share: `${100 - dayPct}%`,
            currencySymbol: request.currencySymbol
        }),
        costRow(R, {
            label: 'Total',
            kWh: request.totalCons,
            cost: request.totalCost,
            share: '100%',
            currencySymbol: request.currencySymbol
        })
    );
    appendSeparator(request.rows);
}

function appendTouCostSection(request: CostAnalysisSectionRequest): void {
    const R = energyRow;
    request.rows.push(
        sectionHeader(R, 'COST'),
        costRow(R, {
            label: 'Variable rate (TOU)',
            kWh: request.totalCons,
            cost: request.totalCost,
            share: '100%',
            currencySymbol: request.currencySymbol,
            note: 'Per-window breakdown not emitted; configure dashboard tariff_windows for full detail'
        })
    );
    appendSeparator(request.rows);
}

function appendOpportunitySection(request: CostAnalysisSectionRequest): void {
    if (request.touShift.savings <= 0) return;
    const fraction = Math.round(request.touShiftableFraction * 100);
    request.rows.push(
        energyRow({
            section: 'OPPORTUNITY',
            consumption_kwh: request.touShift.shiftedKWh,
            cost: `${request.currencySymbol}${request.touShift.savings.toFixed(2)}`,
            notes: `Shift ${fraction}% from peak to off-peak → save ${request.currencySymbol}${request.touShift.savings.toFixed(2)}`
        })
    );
    appendSeparator(request.rows);
}

function costRow(
    R: EnergyRowBuilder,
    input: {
        label: string;
        kWh: number;
        cost: number;
        share: string;
        currencySymbol: string;
        note?: string;
    }
): ReportRow {
    return R({
        device: input.label,
        consumption_kwh: +input.kWh.toFixed(3),
        cost: `${input.currencySymbol}${input.cost.toFixed(2)}`,
        share_pct: input.share,
        notes: input.note ?? ''
    });
}

function sectionHeader(R: EnergyRowBuilder, label: string): ReportRow {
    return R({section: label});
}

function appendSeparator(rows: ReportRow[]): void {
    rows.push({...energyRowBlank()});
}

async function writeReportRow(rows: ReportRowSink, row: ReportRow) {
    if (rows.write) {
        await rows.write(row);
        return;
    }
    rows.push(row);
}
