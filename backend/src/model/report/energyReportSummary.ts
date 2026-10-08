import type {AlwaysOnResult} from './alwaysOn';
import type {AlwaysOnTariffMode} from './alwaysOnCost';
import {computeAlwaysOnCost} from './alwaysOnCost';
import {fetchAlwaysOn} from './alwaysOnRepo';
import type {DataQualityResult} from './dataQuality';
import {fetchDataQuality} from './dataQualityRepo';
import {
    averagePowerFactor,
    energyRow,
    energyRowBlank,
    maxPhaseImbalancePct
} from './energyEngineHelpers';
import {computeLoadFactor} from './loadFactor';
import {computeDelta, formatDeltaPct} from './periodDeltas';
import type {ProjectionResult} from './projection';
import {projectionRange, projectPeriodTotal} from './projection';
import {roundReportTotalKWh} from './rowEconomics';
import {evaluateVoltageQuality} from './voltageQualityBadge';

type ReportRow = Record<string, any>;

export interface EnergySummarySectionRequest {
    rows: ReportRow[];
    internalIds: readonly number[];
    shellyIDs: readonly string[];
    from: string;
    to: string;
    fromDate: Date;
    toDate: Date;
    priorFrom: Date;
    priorTo: Date;
    granularity: string;
    currency: string;
    currencySymbol: string;
    nominalVoltage: number;
    tariffMode: AlwaysOnTariffMode;
    tariff: number;
    dayRate: number;
    nightRate: number;
    dayStart: string;
    dayEnd: string;
    onlineCount: number;
    tsRows: readonly ReportRow[];
    phaseRows: readonly ReportRow[];
    precomputedAvgPowerFactor?: number | null;
    precomputedDataQuality?: DataQualityResult;
    totalCons: number;
    totalRet: number;
    totalCost: number;
    peakPower: number;
    avgVoltage: number;
    priorTotalCons: number;
    periodDays: number;
}

export interface EnergySummarySectionResult {
    dq: DataQualityResult;
    fromLabel: string;
    toLabel: string;
    projection: ProjectionResult;
    alwaysOn: AlwaysOnResult;
    priorAlwaysOn: AlwaysOnResult;
    avgPowerFactor: number | null;
}

export async function appendEnergySummarySections(
    request: EnergySummarySectionRequest
): Promise<EnergySummarySectionResult> {
    const dq =
        request.precomputedDataQuality ??
        (await fetchDataQuality({
            deviceIds: request.internalIds,
            from: request.fromDate,
            to: request.toDate,
            granularity: request.granularity
        }));
    const fromLabel = utcDateLabel(request.from);
    const toLabel = utcDateLabel(request.to);
    appendReportHeader({request, dq, fromLabel, toLabel});

    const avgPowerFactor =
        request.precomputedAvgPowerFactor === undefined
            ? averagePowerFactor(request.tsRows)
            : request.precomputedAvgPowerFactor;
    appendFleetSummary(request);

    const {alwaysOn, priorAlwaysOn} = await fetchAlwaysOnPair(request);
    appendAlwaysOnRow({request, alwaysOn});

    const projection = projectPeriodTotal({
        kwhSoFar: request.totalCons,
        costSoFar: request.totalCost,
        from: request.fromDate,
        to: request.toDate,
        now: new Date(),
        // The buckets are already loaded here. Passing them moves the
        // projection onto whole days and lets the confidence band be measured
        // from how steady this site actually is.
        series: request.tsRows as unknown as {
            date: string;
            consumption_kwh: number;
        }[],
        // Already computed above. Baseload is flat, so only the variable part
        // should scale with the remaining days.
        baselineKWhPerDay: alwaysOnPerDay(alwaysOn, request)
    });
    appendProjectionRow({request, projection});
    request.rows.push({...energyRowBlank()});

    return {
        dq,
        fromLabel,
        toLabel,
        projection,
        alwaysOn,
        priorAlwaysOn,
        avgPowerFactor
    };
}

function utcDateLabel(value: string): string {
    return `${new Date(value).toISOString().slice(0, 10)} UTC`;
}

function appendReportHeader(input: {
    request: EnergySummarySectionRequest;
    dq: DataQualityResult;
    fromLabel: string;
    toLabel: string;
}): void {
    const tariffDesc =
        input.request.tariffMode === 'day_night'
            ? `Day ${input.request.currencySymbol}${input.request.dayRate}, Night ${input.request.currencySymbol}${input.request.nightRate} (${input.request.dayStart.slice(0, 5)}-${input.request.dayEnd.slice(0, 5)})`
            : `${input.request.currencySymbol}${input.request.tariff}/kWh`;
    input.request.rows.push(
        energyRow({
            section: 'REPORT',
            date: `${input.fromLabel} - ${input.toLabel}`,
            device: `${input.request.shellyIDs.length} devices (${input.request.onlineCount} online)`,
            cost: input.request.currency,
            notes: `${input.request.granularity}, ${tariffDesc}, data quality ${Math.round(input.dq.overall * 100)}%`
        }),
        {...energyRowBlank()}
    );
}

function appendFleetSummary(request: EnergySummarySectionRequest): void {
    request.rows.push(fleetTotalRow(request));
    appendLoadFactorRow(request);
    appendVoltageQualityRow(request);
}

function fleetTotalRow(request: EnergySummarySectionRequest): ReportRow {
    const fleetDeltaPct = formatDeltaPct(
        computeDelta(
            request.totalCons,
            request.priorTotalCons > 0 ? request.priorTotalCons : null
        ).deltaPct
    );
    const priorTotalCost =
        request.tariffMode === 'single' &&
        request.tariff > 0 &&
        request.priorTotalCons > 0
            ? request.priorTotalCons * request.tariff
            : null;
    const fleetCostDeltaPct = formatDeltaPct(
        computeDelta(request.totalCost, priorTotalCost).deltaPct
    );
    const deltaSummary = fleetCostDeltaPct
        ? `${fleetDeltaPct} kWh, ${fleetCostDeltaPct} cost`
        : fleetDeltaPct;
    return energyRow({
        section: 'SUMMARY',
        device: 'Fleet total',
        consumption_kwh: roundReportTotalKWh(request.totalCons),
        returned_kwh: roundReportTotalKWh(request.totalRet),
        net_kwh: roundReportTotalKWh(request.totalCons - request.totalRet),
        cost: `${request.currencySymbol}${request.totalCost.toFixed(2)}`,
        power_w: +request.peakPower.toFixed(0),
        voltage_v: request.avgVoltage,
        delta_pct: deltaSummary,
        notes: `${+(request.totalCons / request.periodDays).toFixed(1)} kWh/day, ${request.currencySymbol}${(request.totalCost / request.periodDays).toFixed(2)}/day`
    });
}

function appendLoadFactorRow(request: EnergySummarySectionRequest): void {
    const avgFleetKW = request.totalCons / Math.max(1, request.periodDays * 24);
    const peakFleetKW = request.peakPower / 1000;
    const loadFactor = computeLoadFactor({
        avgKW: avgFleetKW,
        peakKW: peakFleetKW
    });
    if (loadFactor === null) return;
    request.rows.push(
        energyRow({
            section: 'SUMMARY',
            device: 'Load factor',
            notes: `${(loadFactor * 100).toFixed(1)}% — avg ${avgFleetKW.toFixed(2)} kW / peak ${peakFleetKW.toFixed(2)} kW`
        })
    );
}

function appendVoltageQualityRow(request: EnergySummarySectionRequest): void {
    const voltage = voltageRange(request.tsRows);
    const quality = evaluateVoltageQuality({
        minVoltage: voltage.min,
        maxVoltage: voltage.max,
        nominalVoltage: request.nominalVoltage,
        imbalancePct: maxPhaseImbalancePct(request.phaseRows)
    });
    if (quality.status === 'unknown') return;
    const detail =
        quality.status === 'pass'
            ? 'within ±10% band, imbalance ≤2%'
            : quality.reasons.join('; ');
    request.rows.push(
        energyRow({
            section: 'SUMMARY',
            device: 'Voltage quality',
            delta_pct: quality.status.toUpperCase(),
            notes: detail
        })
    );
}

function voltageRange(rows: readonly ReportRow[]): {
    min: number | null;
    max: number | null;
} {
    const mins = rows
        .map((row) => row.voltage_min_v)
        .filter((value): value is number => typeof value === 'number');
    const maxes = rows
        .map((row) => row.voltage_max_v)
        .filter((value): value is number => typeof value === 'number');
    return {
        min: mins.length > 0 ? Math.min(...mins) : null,
        max: maxes.length > 0 ? Math.max(...maxes) : null
    };
}

async function fetchAlwaysOnPair(request: EnergySummarySectionRequest) {
    const priorPeriodHours =
        (request.priorTo.getTime() - request.priorFrom.getTime()) /
        (1000 * 60 * 60);
    const [alwaysOn, priorAlwaysOn] = await Promise.all([
        fetchAlwaysOn({
            deviceIds: request.internalIds,
            from: request.fromDate,
            to: request.toDate,
            periodHours: request.periodDays * 24
        }),
        priorPeriodHours > 0
            ? fetchAlwaysOn({
                  deviceIds: request.internalIds,
                  from: request.priorFrom,
                  to: request.priorTo,
                  periodHours: priorPeriodHours
              })
            : Promise.resolve({
                  totalKWh: 0,
                  perDeviceWatts: new Map<number, number>()
              })
    ]);
    return {alwaysOn, priorAlwaysOn};
}

function appendAlwaysOnRow(input: {
    request: EnergySummarySectionRequest;
    alwaysOn: EnergySummarySectionResult['alwaysOn'];
}): void {
    if (input.alwaysOn.totalKWh <= 0) return;
    const cost = computeAlwaysOnCost({
        totalKWh: input.alwaysOn.totalKWh,
        tariffMode: input.request.tariffMode,
        tariff: input.request.tariff,
        dayRate: input.request.dayRate,
        nightRate: input.request.nightRate,
        dayStart: input.request.dayStart,
        dayEnd: input.request.dayEnd
    });
    const share =
        input.request.totalCons > 0
            ? Math.round(
                  (input.alwaysOn.totalKWh / input.request.totalCons) * 100
              )
            : 0;
    const detail = cost.splitByDayNight
        ? `Estimated continuous baseline across ${input.alwaysOn.perDeviceWatts.size} devices — day ${cost.dayKWh} kWh / night ${cost.nightKWh} kWh`
        : `Estimated continuous baseline across ${input.alwaysOn.perDeviceWatts.size} devices`;
    input.request.rows.push(
        energyRow({
            device: 'ESTIMATED BASELINE',
            consumption_kwh: input.alwaysOn.totalKWh,
            cost: `${input.request.currencySymbol}${cost.totalCost.toFixed(2)}`,
            share_pct: `${share}%`,
            notes: detail
        })
    );
}

/** The always-on figure is a period total; the projection wants per day. */
function alwaysOnPerDay(
    alwaysOn: AlwaysOnResult | null,
    request: EnergySummarySectionRequest
): number | undefined {
    if (!alwaysOn || !Number.isFinite(alwaysOn.totalKWh)) return undefined;
    const days =
        (request.toDate.getTime() - request.fromDate.getTime()) /
        (24 * 60 * 60 * 1000);
    if (!Number.isFinite(days) || days <= 0) return undefined;
    return alwaysOn.totalKWh / days;
}

function appendProjectionRow(input: {
    request: EnergySummarySectionRequest;
    projection: ProjectionResult;
}): void {
    if (!input.projection.extrapolated) return;
    // Null means the spread could not be measured. Saying "confidence unknown"
    // is the honest reading; printing a number would invent one.
    const {confidenceBand} = input.projection;
    const range = projectionRange(input.projection);
    // A range is read correctly far more often than a percentage.
    const notes = range
        ? `End-of-period forecast (${range} kWh)`
        : confidenceBand === null
          ? 'End-of-period forecast (confidence unknown)'
          : 'End-of-period forecast';
    input.request.rows.push(
        energyRow({
            device: 'PROJECTION',
            consumption_kwh: input.projection.projectedKWh,
            cost: `${input.request.currencySymbol}${input.projection.projectedCost.toFixed(2)}`,
            notes
        })
    );
}
