import type {PoolClient} from 'pg';
import {tuning} from '../../config';
import {withPooledClient} from '../../modules/PostgresProvider';
import {ELECTRICAL_SOURCES} from '../../types/api/energy';
import {streamSelectCsvRowsWithClient} from '../energy/streamingExportRunner';
import type {PhaseGroup} from './anomalies';
import type {DataQualityResult} from './dataQuality';
import type {CostPriceResolver} from './energyCostEngine';
import type {DeviceAggregate} from './energyEngineHelpers';
import {chooseLoadDurationBands} from './energyEngineHelpers';
import {displayBucketKey} from './energyReportCost';
import {
    BATTERY_MEASURED_METRIC_TAGS,
    computeMeasuredMetrics,
    ELECTRICAL_MEASURED_METRIC_TAGS,
    ELECTRICAL_RECORD_METRIC_TAGS,
    type MeasuredMetrics,
    type MetricStat,
    type RawStat
} from './energyReportMeasured';
import type {FrequencyStats} from './energyReportPowerQuality';
import {deviceDisplayName} from './engineHelpers';
import type {LoadDurationBand} from './loadDurationCurve';
import {weekdayInZone} from './localTimeInZone';
import {ReportRowSpool} from './reportRowSpool';
import {deriveRowEconomics, type RateContext} from './rowEconomics';
import {
    storedQuantityToBilled,
    type TariffQuantityMetric,
    tariffQuantityMetric
} from './tariffQuantity';

type ReportRow = Record<string, any>;
// Exported for backend/test/energyReportBoundedDevicePeak.test.ts, which
// drives streamTimeSeries with a fake row source and inspects the SQL it
// is handed. No production caller constructs a StreamRows outside this file.
export type StreamRows = (
    sql: string,
    onRow: (row: Record<string, string>) => Promise<void>
) => Promise<void>;

const TAGS = [
    'total_act_energy',
    'total_act_ret_energy',
    'power',
    'min_voltage',
    'max_voltage',
    'current',
    'min_current',
    'max_current',
    'frequency',
    ...ELECTRICAL_MEASURED_METRIC_TAGS,
    ...ELECTRICAL_RECORD_METRIC_TAGS
] as const;

interface CostSpoolRow extends Record<string, unknown> {
    key: string;
    bucket_ms: number;
    device: number;
    consumption_kwh: number;
    returned_kwh: number;
    cost: number;
}

interface ScopeCost {
    consumptionKWh: number;
    returnedKWh: number;
    cost: number;
}

interface StreamedCostResult {
    totals: ScopeCost & {
        dayConsumptionKWh: number;
        nightConsumptionKWh: number;
        dayCost: number;
        nightCost: number;
    };
    perDevice: Map<number, ScopeCost>;
    estimatedKWh: number;
    spool: ReportRowSpool<CostSpoolRow>;
}

export interface BoundedTimeSeriesAggregation {
    spool: ReportRowSpool<ReportRow>;
    analysisRows: ReportRow[];
    deviceAgg: Map<number, DeviceAggregate>;
    totalCons: number;
    totalRet: number;
    totalCost: number;
    /** Measured usage charge before presentation rounding. */
    measuredUsageCostAmount: number;
    peakPower: number;
    /** Highest coincident power a device drew, in watts — phases and channels
     *  summed at one instant, then the maximum over the window. Keyed by
     *  internal device id. Absent when a device reported no power samples.
     *  Kept separate from peakPower: a role-filtered section cannot use a
     *  number that has already collapsed across devices. */
    devicePeakW: Map<number, number>;
    avgVoltage: number;
    dayCons: number;
    nightCons: number;
    dayCost: number;
    nightCost: number;
    estimatedKWh: number;
    avgPowerFactor: number | null;
    loadDurationBands: readonly LoadDurationBand[];
    weekdayKWh: number;
    weekendKWh: number;
    /** Billed demand, in watts: the highest 15-minute average the peak-device
     *  selection drew together. A demand charge bills the interval average,
     *  never the instant — devicePeakW is the instant. */
    truePeakPower: number | null;
    frequency: FrequencyStats;
    measured: MeasuredMetrics;
    dataQuality: DataQualityResult;
}

export interface BoundedPhaseAggregation {
    spool: ReportRowSpool<ReportRow>;
    analysisRows: ReportRow[];
    phaseGroups: Map<string, PhaseGroup>;
    rowCount: number;
}

export interface BoundedEnergySeries {
    timeSeries: BoundedTimeSeriesAggregation;
    phase: BoundedPhaseAggregation;
    cleanup(): Promise<void>;
}

export interface BoundedEnergySeriesRequest {
    internalIds: number[];
    from: Date;
    to: Date;
    bucket: string;
    granularity: string;
    timezone: string | null;
    deviceMap: Map<number, string>;
    rate: RateContext;
    costResolver?: CostPriceResolver | null;
    peakInternalIds?: readonly number[];
    quantityMetric?: TariffQuantityMetric;
    /** Mandatory for metrics whose billed quantity is not a fixed unit scale. */
    quantityConversion?: {
        pointQuantity(input: {
            device: number;
            channel: number;
            bucket: string;
            storedValue: number;
            direction?: 'consumption' | 'returned';
        }): number;
        displayQuantity(input: {
            device: number;
            bucket: string;
            storedValue: number;
            direction?: 'consumption' | 'returned';
        }): number;
    };
    electricalSource?: string;
    /** Called at each chunk boundary of every streamed query; throwing aborts
     *  the read, which rolls back and releases the pooled transaction. */
    onChunk?: (rowsRead: number) => Promise<void>;
}

/**
 * Wrap a row stream so `onChunk` runs before the first row and then at every
 * chunk boundary. The streamed queries are the long part of a report, so this
 * is where a cancel has to be noticed; the boundary matches the one the report
 * writers already use.
 */
export function withCancelChecks(
    streamRows: StreamRows,
    onChunk: (rowsRead: number) => Promise<void>
): StreamRows {
    return async (sql, onRow) => {
        let rowsRead = 0;
        await onChunk(rowsRead);
        await streamRows(sql, async (row) => {
            rowsRead += 1;
            if (rowsRead % tuning.report.streamChunkRows === 0) {
                await onChunk(rowsRead);
            }
            await onRow(row);
        });
    };
}

export async function* replayDatedReportRows(
    spool: ReportRowSpool<ReportRow>
): AsyncGenerator<ReportRow> {
    for await (const row of spool.rows()) {
        yield {
            ...row,
            date: typeof row.date === 'string' ? new Date(row.date) : row.date
        };
    }
}

export async function buildBoundedEnergySeries(
    request: BoundedEnergySeriesRequest
): Promise<BoundedEnergySeries> {
    const timeSpool = await ReportRowSpool.create<ReportRow>('time-series');
    const phaseSpool = await ReportRowSpool.create<ReportRow>('phase-series');
    try {
        const result = await withPooledClient(async (client: PoolClient) => {
            await client.query(
                'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
            );
            const readRows: StreamRows = (sql, onRow) =>
                streamSelectCsvRowsWithClient(client, sql, onRow);
            const streamRows = request.onChunk
                ? withCancelChecks(readRows, request.onChunk)
                : readRows;
            const cost = request.costResolver
                ? await streamCostSeries(
                      request,
                      request.costResolver,
                      streamRows
                  )
                : null;
            const timeSeries = await streamTimeSeries(
                request,
                timeSpool,
                cost,
                streamRows
            );
            const phase = await streamPhaseSeries(
                request,
                phaseSpool,
                streamRows
            );
            Object.assign(
                timeSeries.measured,
                await streamBatteryMetrics(request, streamRows)
            );
            return {timeSeries, phase, costSpool: cost?.spool};
        });
        await result.costSpool?.remove();
        return {
            timeSeries: result.timeSeries,
            phase: result.phase,
            cleanup: async () => {
                await Promise.all([timeSpool.remove(), phaseSpool.remove()]);
            }
        };
    } catch (error) {
        await Promise.all([timeSpool.remove(), phaseSpool.remove()]);
        throw error;
    }
}

export async function streamTimeSeries(
    request: BoundedEnergySeriesRequest,
    spool: ReportRowSpool<ReportRow>,
    cost: StreamedCostResult | null,
    streamRows: StreamRows
): Promise<BoundedTimeSeriesAggregation> {
    const deviceAgg = new Map<number, DeviceAggregate>();
    const voltageByDevice = new Map<number, {min: number; max: number}>();
    const totals = emptyTotals();
    const consSum = compensatedSum();
    const retSum = compensatedSum();
    let voltageSum = 0;
    let voltageCount = 0;
    let pfSum = 0;
    let pfCount = 0;
    let weekdayKWh = 0;
    let weekendKWh = 0;
    const truePeakPower = await streamBillingDemandPeak(request, streamRows);
    const devicePeakW = await streamDevicePowerPeak(request, streamRows);
    let frequencySum = 0;
    let frequencyCount = 0;
    let frequencyMin: number | null = null;
    let frequencyMax: number | null = null;
    const metricAccumulators = {
        voltage: emptyMetricAccumulator(),
        power_factor: emptyMetricAccumulator(),
        apparent_power: emptyMetricAccumulator(),
        total_power: emptyMetricAccumulator(),
        total_apparent_power: emptyMetricAccumulator(),
        total_current: emptyMetricAccumulator(),
        neutral_current: emptyMetricAccumulator(),
        ...recordMetricAccumulators()
    };
    const actualBuckets = new Map<number, number>();
    const costLookup = cost ? new CostSpoolLookup(cost.spool.rows()) : null;

    await streamRows(buildTimeSeriesSql(request), async (source) => {
        const device = integer(source.device);
        const date = new Date(source.bucket).toISOString();
        const metric = quantityMetricOf(request);
        const storedConsumption = numeric(source.consumption_wh);
        const consumptionKWh = request.quantityConversion
            ? request.quantityConversion.displayQuantity({
                  device,
                  bucket: date,
                  storedValue: storedConsumption
              })
            : storedQuantityToBilled(storedConsumption, metric);
        const storedReturned = numeric(source.returned_wh);
        const returnedKWh = request.quantityConversion
            ? request.quantityConversion.displayQuantity({
                  device,
                  bucket: date,
                  storedValue: storedReturned,
                  direction: 'returned'
              })
            : storedQuantityToBilled(storedReturned, metric);
        const economics = deriveRowEconomics({
            consumptionKWh,
            returnedKWh,
            bucketDate: date,
            rate: request.rate
        });
        const dynamicCost = costLookup
            ? await costLookup.take(
                  displayBucketKey(date, request.granularity, device)
              )
            : null;
        const rowCost = dynamicCost?.cost ?? economics.cost;
        const power = optionalNumeric(source.power_avg);
        const voltage = optionalNumeric(source.voltage_avg);
        const minVoltage = optionalNumeric(source.voltage_min);
        const maxVoltage = optionalNumeric(source.voltage_max);
        const current = optionalNumeric(source.current_avg);
        const maxCurrent = optionalNumeric(source.current_max);
        const powerFactor = optionalNumeric(source.power_factor_avg);
        const rowFrequencyCount = numeric(source.frequency_count);
        frequencySum += numeric(source.frequency_sum);
        frequencyCount += rowFrequencyCount;
        frequencyMin = minNullable(
            frequencyMin,
            optionalNumeric(source.frequency_min)
        );
        frequencyMax = maxNullable(
            frequencyMax,
            optionalNumeric(source.frequency_max)
        );
        addMetricAccumulator(metricAccumulators.voltage, {
            sum: numeric(source.voltage_sum),
            count: numeric(source.voltage_count),
            min: optionalNumeric(source.voltage_metric_min),
            max: optionalNumeric(source.voltage_metric_max)
        });
        addMetricAccumulator(metricAccumulators.power_factor, {
            sum: numeric(source.power_factor_sum),
            count: numeric(source.power_factor_count),
            min: optionalNumeric(source.power_factor_min),
            max: optionalNumeric(source.power_factor_max)
        });
        addMetricFromSource(
            metricAccumulators.apparent_power,
            source,
            'apparent_power'
        );
        addMetricFromSource(
            metricAccumulators.total_power,
            source,
            'total_power'
        );
        addMetricFromSource(
            metricAccumulators.total_apparent_power,
            source,
            'total_apparent_power'
        );
        addMetricFromSource(
            metricAccumulators.total_current,
            source,
            'total_current'
        );
        addMetricFromSource(
            metricAccumulators.neutral_current,
            source,
            'neutral_current'
        );
        for (const tag of ELECTRICAL_RECORD_METRIC_TAGS) {
            addMetricFromSource(metricAccumulators[tag], source, tag);
        }
        if (numeric(source.energy_point_count) > 0) {
            actualBuckets.set(device, (actualBuckets.get(device) ?? 0) + 1);
        }
        const row: ReportRow = {
            date,
            device: deviceDisplayName(device, request.deviceMap),
            device_id: device,
            consumption_kwh: +consumptionKWh.toFixed(3),
            returned_kwh: +returnedKWh.toFixed(3),
            net_kwh: economics.netKWh,
            cost: +rowCost.toFixed(2),
            power_avg_w: roundedOrBlank(power, 1),
            voltage_avg_v: roundedOrBlank(voltage, 2),
            voltage_min_v: roundedOrBlank(minVoltage, 2),
            voltage_max_v: roundedOrBlank(maxVoltage, 2),
            current_avg_a: roundedOrBlank(current, 3),
            current_max_a: roundedOrBlank(maxCurrent, 3),
            power_factor_avg: roundedOrBlank(powerFactor, 3)
        };
        await spool.write(row);
        addCompensated(consSum, consumptionKWh);
        addCompensated(retSum, returnedKWh);
        updateTotals(totals, {
            consumptionKWh,
            rowCost: dynamicCost?.cost ?? consumptionKWh * economics.rate,
            power,
            isDay: economics.isDay
        });
        updateDeviceAggregate(deviceAgg, device, {
            consumptionKWh,
            returnedKWh,
            rowCost: dynamicCost?.cost ?? consumptionKWh * economics.rate,
            power,
            voltage,
            current
        });
        if (voltage !== null) {
            voltageSum += voltage;
            voltageCount++;
        }
        if (powerFactor !== null) {
            pfSum += powerFactor;
            pfCount++;
        }
        updateVoltageRange(voltageByDevice, device, minVoltage, maxVoltage);
        if (consumptionKWh >= 0) {
            const day = weekdayInZone(new Date(date), request.timezone);
            if (day === 0 || day === 6) weekendKWh += consumptionKWh;
            else weekdayKWh += consumptionKWh;
        }
    });
    await spool.close();

    const measuredUsageCostAmount = cost?.totals.cost ?? totals.totalCost;
    if (cost) {
        totals.totalCost = round2(cost.totals.cost);
        totals.dayCons = cost.totals.dayConsumptionKWh;
        totals.nightCons = cost.totals.nightConsumptionKWh;
        totals.dayCost = cost.totals.dayCost;
        totals.nightCost = cost.totals.nightCost;
        for (const [device, aggregate] of deviceAgg) {
            aggregate.cost = round2(cost.perDevice.get(device)?.cost ?? 0);
        }
    }
    const totalCons = compensatedValue(consSum);
    const totalRet = compensatedValue(retSum);
    const analysisRows = [...voltageByDevice].map(([device, range]) => ({
        device: deviceDisplayName(device, request.deviceMap),
        voltage_min_v: range.min === Infinity ? '' : range.min,
        voltage_max_v: range.max === -Infinity ? '' : range.max
    }));
    const loadDurationBands = isElectricityReport(request)
        ? await calculateLoadDuration(spool, totals.peakPower)
        : [];
    return {
        spool,
        analysisRows,
        deviceAgg,
        totalCons,
        totalRet,
        totalCost: totals.totalCost,
        measuredUsageCostAmount,
        peakPower: totals.peakPower,
        devicePeakW,
        avgVoltage:
            voltageCount > 0 ? +(voltageSum / voltageCount).toFixed(1) : 0,
        dayCons: totals.dayCons,
        nightCons: totals.nightCons,
        dayCost: totals.dayCost,
        nightCost: totals.nightCost,
        estimatedKWh: cost?.estimatedKWh ?? 0,
        avgPowerFactor: pfCount > 0 ? pfSum / pfCount : null,
        loadDurationBands,
        weekdayKWh,
        weekendKWh,
        truePeakPower,
        frequency: {
            avgHz: frequencyCount > 0 ? frequencySum / frequencyCount : null,
            minHz: frequencyMin,
            maxHz: frequencyMax
        },
        measured: computeMeasuredMetrics(
            new Map(
                Object.entries(metricAccumulators).map(([tag, accumulator]) => [
                    tag,
                    metricStat(accumulator) ?? {
                        avg: null,
                        min: null,
                        max: null
                    }
                ])
            )
        ),
        dataQuality: buildDataQuality(request, actualBuckets)
    };
}

// A demand charge bills the highest 15-minute AVERAGE, not an instant, which is
// already how TariffDemandSample models it. Reading the rollup also lets this
// answer a year — fn_device_power_peak could not, raw is trimmed to ~31 days.
async function streamBillingDemandPeak(
    request: BoundedEnergySeriesRequest,
    streamRows: StreamRows
): Promise<number | null> {
    if (!isElectricityReport(request)) return null;
    let peak: number | null = null;
    await streamRows(buildBillingDemandPeakSql(request), async (source) => {
        peak = maxNullable(peak, optionalNumeric(source.peak_w));
    });
    return peak;
}

// devicePeakW gets its own query instead of a column on the time-series
// SELECT. A device's power at an instant is the SUM of its phases (triphase
// em:0) or its channels (monophase em1:0/1/2), and the 15-minute rollup has
// already collapsed that instant away — MAX over per-phase rows reported about
// a third of a 3-phase meter's real power. device_em.fn_device_power_peak
// (migration 20044) does the coincident sum on raw rows and returns one peak
// per device for the whole window, which is exactly the shape devicePeakW is.
async function streamDevicePowerPeak(
    request: BoundedEnergySeriesRequest,
    streamRows: StreamRows
): Promise<Map<number, number>> {
    const peaks = new Map<number, number>();
    if (!isElectricityReport(request)) return peaks;
    await streamRows(buildDevicePowerPeakSql(request), async (source) => {
        const watts = optionalNumeric(source.peak_w);
        if (watts !== null) peaks.set(integer(source.device), watts);
    });
    return peaks;
}

async function streamBatteryMetrics(
    request: BoundedEnergySeriesRequest,
    streamRows: StreamRows
): Promise<Partial<MeasuredMetrics>> {
    if (!isElectricityReport(request)) return {};
    const raw = new Map<string, MetricStat>();
    await streamRows(buildBatteryMetricsSql(request), async (source) => {
        raw.set(source.tag, {
            avg: optionalNumeric(source.avg_value),
            min: optionalNumeric(source.min_value),
            max: optionalNumeric(source.max_value)
        });
    });
    const measured = computeMeasuredMetrics(raw);
    return {
        stateOfCharge: measured.stateOfCharge,
        stateOfHealth: measured.stateOfHealth,
        cycles: measured.cycles,
        chargeAh: measured.chargeAh,
        dischargeAh: measured.dischargeAh
    };
}

async function streamPhaseSeries(
    request: BoundedEnergySeriesRequest,
    spool: ReportRowSpool<ReportRow>,
    streamRows: StreamRows
): Promise<BoundedPhaseAggregation> {
    if (!isElectricityReport(request)) {
        await spool.close();
        return {
            spool,
            analysisRows: [],
            phaseGroups: new Map(),
            rowCount: 0
        };
    }
    const worstByDevice = new Map<string, {group: PhaseGroup; pct: number}>();
    let currentKey = '';
    let current:
        | {device: number; date: string; rows: ReportRow[]; group: PhaseGroup}
        | undefined;

    const flush = async () => {
        if (!current) return;
        const pct = imbalancePct(current.group);
        for (const row of current.rows) {
            if (row.phase === 'L1' && pct !== null) row.imbalance_pct = pct;
            await spool.write(row);
        }
        if (pct !== null) {
            const label = deviceDisplayName(current.device, request.deviceMap);
            const existing = worstByDevice.get(label);
            if (!existing || pct > existing.pct) {
                worstByDevice.set(label, {group: {...current.group}, pct});
            }
        }
    };

    await streamRows(buildPhaseSeriesSql(request), async (source) => {
        const device = integer(source.device);
        const key = `${source.bucket}::${device}`;
        if (key !== currentKey) {
            await flush();
            currentKey = key;
            current = {
                device,
                date: new Date(source.bucket).toISOString(),
                rows: [],
                group: {l1: 0, l2: 0, l3: 0}
            };
        }
        const phase = phaseLabel(source.phase);
        const power = optionalNumeric(source.power_avg);
        if (power !== null) assignPhasePower(current!.group, phase, power);
        current!.rows.push({
            date: new Date(source.bucket).toISOString(),
            device: deviceDisplayName(device, request.deviceMap),
            phase,
            consumption_kwh: +storedQuantityToBilled(
                numeric(source.consumption_wh),
                quantityMetricOf(request)
            ).toFixed(3),
            power_w: roundedOrBlank(power, 1),
            voltage_v: roundedOrBlank(optionalNumeric(source.voltage_avg), 2),
            current_a: roundedOrBlank(optionalNumeric(source.current_avg), 3)
        });
    });
    await flush();
    await spool.close();
    const phaseGroups = new Map<string, PhaseGroup>();
    const analysisRows: ReportRow[] = [];
    for (const [device, value] of worstByDevice) {
        phaseGroups.set(`worst::${device}`, value.group);
        analysisRows.push({device, imbalance_pct: value.pct});
    }
    return {spool, analysisRows, phaseGroups, rowCount: spool.length};
}

async function streamCostSeries(
    request: BoundedEnergySeriesRequest,
    resolver: CostPriceResolver,
    streamRows: StreamRows
): Promise<StreamedCostResult> {
    const spool = await ReportRowSpool.create<CostSpoolRow>('cost-series');
    const totals = {
        consumptionKWh: 0,
        returnedKWh: 0,
        cost: 0,
        dayConsumptionKWh: 0,
        nightConsumptionKWh: 0,
        dayCost: 0,
        nightCost: 0
    };
    const perDevice = new Map<number, ScopeCost>();
    let estimatedKWh = 0;
    let current: CostSpoolRow | undefined;

    const flush = async () => {
        if (current) await spool.write(current);
        current = undefined;
    };
    await streamRows(buildCostSql(request), async (source) => {
        const device = integer(source.device);
        const quantityMetric = quantityMetricOf(request);
        const storedConsumption = numeric(source.consumption_wh);
        const consumptionUnits = request.quantityConversion
            ? request.quantityConversion.pointQuantity({
                  device,
                  channel: integer(source.channel),
                  bucket: source.bucket,
                  storedValue: storedConsumption
              })
            : storedQuantityToBilled(storedConsumption, quantityMetric);
        const storedReturned = numeric(source.returned_wh);
        const returnedUnits = request.quantityConversion
            ? request.quantityConversion.pointQuantity({
                  device,
                  channel: integer(source.channel),
                  bucket: source.bucket,
                  storedValue: storedReturned,
                  direction: 'returned'
              })
            : storedQuantityToBilled(storedReturned, quantityMetric);
        const pricing = resolver({
            device,
            channel: integer(source.channel),
            bucket: source.bucket,
            consumptionUnits,
            returnedUnits
        });
        const consumptionKWh = consumptionUnits;
        const returnedKWh = returnedUnits;
        const rowCost = consumptionKWh * pricing.price;
        if (pricing.estimated) estimatedKWh += consumptionKWh;
        addScopeCost(totals, consumptionKWh, returnedKWh, rowCost);
        if (pricing.isDay) {
            totals.dayConsumptionKWh += consumptionKWh;
            totals.dayCost += rowCost;
        } else {
            totals.nightConsumptionKWh += consumptionKWh;
            totals.nightCost += rowCost;
        }
        const deviceCost = perDevice.get(device) ?? emptyScopeCost();
        addScopeCost(deviceCost, consumptionKWh, returnedKWh, rowCost);
        perDevice.set(device, deviceCost);
        const key = displayBucketKey(
            source.bucket,
            request.granularity,
            device
        );
        if (!current || current.key !== key) {
            await flush();
            current = {
                key,
                bucket_ms: new Date(source.bucket).getTime(),
                device,
                consumption_kwh: 0,
                returned_kwh: 0,
                cost: 0
            };
        }
        current.consumption_kwh += consumptionKWh;
        current.returned_kwh += returnedKWh;
        current.cost += rowCost;
    });
    await flush();
    await spool.close();
    return {totals, perDevice, estimatedKWh, spool};
}

class CostSpoolLookup {
    private readonly iterator: AsyncIterator<CostSpoolRow>;
    private current: CostSpoolRow | undefined;

    constructor(rows: AsyncIterable<CostSpoolRow>) {
        this.iterator = rows[Symbol.asyncIterator]();
    }

    async take(key: string): Promise<CostSpoolRow | null> {
        while (!this.current || compareCostKey(this.current.key, key) < 0) {
            const next = await this.iterator.next();
            if (next.done) return null;
            this.current = next.value;
        }
        return this.current.key === key ? this.current : null;
    }
}

function compareCostKey(left: string, right: string): number {
    const [leftTime, leftDevice] = left.split('::').map(Number);
    const [rightTime, rightDevice] = right.split('::').map(Number);
    return leftTime - rightTime || leftDevice - rightDevice;
}

async function calculateLoadDuration(
    spool: ReportRowSpool<ReportRow>,
    peakPower: number
): Promise<readonly LoadDurationBand[]> {
    const edges = chooseLoadDurationBands(peakPower / 1_000);
    const counts = new Array<number>(edges.length).fill(0);
    let total = 0;
    for await (const row of spool.rows()) {
        if (typeof row.power_avg_w !== 'number') continue;
        const power = row.power_avg_w / 1_000;
        let index = 0;
        for (let i = 0; i < edges.length; i++) {
            if (power >= edges[i]) index = i;
            else break;
        }
        counts[index]++;
        total++;
    }
    return edges.map((fromKW, index) => ({
        fromKW,
        toKW: index + 1 < edges.length ? edges[index + 1] : null,
        hours: counts[index],
        sharePct:
            total > 0 ? Math.round((counts[index] / total) * 1_000) / 10 : 0
    }));
}

// Stage one of two. This query is where a tag becomes a generic quantity —
// total_act_energy becomes consumption_wh, total_act_ret_energy becomes
// returned_wh (below) — and every downstream kWh field and
// DeviceAggregate.cons/ret inherits that mapping from here. It is NOT where
// charge and discharge get decided. That is stage two,
// appendBatteryEfficiencyRows (energyEngineHelpers.ts), which reads this
// same {cons, ret} pair for a battery-role device and is where cons becomes
// "charged" and ret becomes "discharged" on the report row.
//
// This query also never sees a battery reading. sourceSql (below) filters
// to `s.commodity = 'electricity' AND s.electrical_source IS NOT DISTINCT
// FROM 'ac_mains'`, so a dc_battery-tagged row cannot reach it — whatever
// this query characterizes, it is not battery-specific.
//
// EnergyLogicalMeterPoint carries a directionHint, but no arithmetic reads
// it at either stage (LogicalMeterRepository writes and returns it, and
// that is the end of the chain). Until a caller reads it, a reversed clamp
// is indistinguishable from a real reading, at either stage. Stage one is
// pinned by test/integration/batteryDirectionSemantics.integration.ts;
// stage two is pinned by test/batteryDirectionRenderer.test.ts.
//
// energyReportAggregation.ts:42 carries an identical TIME_SERIES_TAGS table
// encoding the same stage-one rule, deliberately left uncommented: it has
// zero production callers (buildTimeSeriesAggregation is exercised only by
// tests), so annotating it would document dead code as if it mattered.
function buildTimeSeriesSql(request: BoundedEnergySeriesRequest): string {
    const source = sourceSql(request);
    const metric = quantityMetricOf(request);
    const returnedFilter = metric.returnedTag
        ? `WHERE s.tag = '${metric.returnedTag}'`
        : 'WHERE FALSE';
    return `SELECT time_bucket('${safeBucket(request.bucket)}', s.bucket) AS bucket,
                   s.device,
                   COALESCE(SUM(s.sum_val) FILTER (WHERE s.tag = '${metric.consumptionTag}'), 0) AS consumption_wh,
                   COALESCE(SUM(s.sum_val) FILTER (${returnedFilter}), 0) AS returned_wh,
                   ${devicePowerAvgSelectSql(request)} AS power_avg,
                   (SUM(s.sum_val) FILTER (WHERE s.tag = 'voltage')) /
                     NULLIF(SUM(s.sample_count) FILTER (WHERE s.tag = 'voltage'), 0) AS voltage_avg,
                   MIN(s.min_val) FILTER (WHERE s.tag = 'min_voltage') AS voltage_min,
                   MAX(s.max_val) FILTER (WHERE s.tag = 'max_voltage') AS voltage_max,
                   (SUM(s.sum_val) FILTER (WHERE s.tag = 'current')) /
                     NULLIF(SUM(s.sample_count) FILTER (WHERE s.tag = 'current'), 0) AS current_avg,
                   MAX(s.max_val) FILTER (WHERE s.tag = 'max_current') AS current_max,
                   (SUM(s.sum_val) FILTER (WHERE s.tag = 'power_factor')) /
                     NULLIF(SUM(s.sample_count) FILTER (WHERE s.tag = 'power_factor'), 0) AS power_factor_avg
                   ,COALESCE(SUM(s.sum_val) FILTER (WHERE s.tag = 'frequency'), 0) AS frequency_sum
                   ,COALESCE(SUM(s.sample_count) FILTER (WHERE s.tag = 'frequency'), 0) AS frequency_count
                   ,MIN(s.min_val) FILTER (WHERE s.tag = 'frequency') AS frequency_min
                   ,MAX(s.max_val) FILTER (WHERE s.tag = 'frequency') AS frequency_max
                   ,COALESCE(SUM(s.sum_val) FILTER (WHERE s.tag = 'voltage'), 0) AS voltage_sum
                   ,COALESCE(SUM(s.sample_count) FILTER (WHERE s.tag = 'voltage'), 0) AS voltage_count
                   ,MIN(s.min_val) FILTER (WHERE s.tag = 'voltage') AS voltage_metric_min
                   ,MAX(s.max_val) FILTER (WHERE s.tag = 'voltage') AS voltage_metric_max
                   ,COALESCE(SUM(s.sum_val) FILTER (WHERE s.tag = 'power_factor'), 0) AS power_factor_sum
                   ,COALESCE(SUM(s.sample_count) FILTER (WHERE s.tag = 'power_factor'), 0) AS power_factor_count
                   ,MIN(s.min_val) FILTER (WHERE s.tag = 'power_factor') AS power_factor_min
                   ,MAX(s.max_val) FILTER (WHERE s.tag = 'power_factor') AS power_factor_max
                   ${metricSql('apparent_power')}
                   ${metricSql('total_power')}
                   ${metricSql('total_apparent_power')}
                   ${metricSql('total_current')}
                   ${metricSql('neutral_current')}
                   ${ELECTRICAL_RECORD_METRIC_TAGS.map(metricSql).join('\n')}
                   ,COUNT(*) FILTER (WHERE s.tag = '${metric.consumptionTag}') AS energy_point_count
              FROM ${scopedEnergySql(request)} s
              ${devicePowerAvgJoinSql(request)}
             WHERE ${source}
             GROUP BY 1, s.device
             HAVING COUNT(*) FILTER (WHERE s.tag <> 'frequency') > 0
             ORDER BY 1, s.device`;
}

function devicePowerAvgSelectSql(request: BoundedEnergySeriesRequest): string {
    return isElectricityReport(request)
        ? 'MAX(dp.avg_w)'
        : 'NULL::double precision';
}

// Joined, not computed inline: sum_val/sample_count over per-phase rows is
// their MEAN, about a third of a 3-phase meter. The join key is the group key,
// so at most one row matches per group and no aggregate can fan out.
function devicePowerAvgJoinSql(request: BoundedEnergySeriesRequest): string {
    if (!isElectricityReport(request)) return '';
    const ids = request.internalIds.map(safeInteger).join(',');
    const bucket = safeBucket(request.bucket);
    return `LEFT JOIN device_em.fn_device_power_avg(
                          ARRAY[${ids}]::integer[],
                          '${request.from.toISOString()}'::timestamptz,
                          '${request.to.toISOString()}'::timestamptz,
                          '${bucket}'
                      ) dp
                   ON dp.device = s.device
                  AND dp.bucket = time_bucket('${bucket}', s.bucket)`;
}

// Summed across the nominated peak meters per interval, then MAX: the same
// site-coincident shape readStoredDemandSamples uses, so the two billing paths
// cannot disagree about what site demand means.
function buildBillingDemandPeakSql(
    request: BoundedEnergySeriesRequest
): string {
    const ids = (request.peakInternalIds ?? request.internalIds)
        .map(safeInteger)
        .join(',');
    return `SELECT MAX(fleet_demand.watts) AS peak_w
              FROM (
                    SELECT p.bucket, SUM(p.avg_w) AS watts
                      FROM device_em.fn_device_power_avg(
                               ARRAY[${ids}]::integer[],
                               '${request.from.toISOString()}'::timestamptz,
                               '${request.to.toISOString()}'::timestamptz,
                               '15 minutes'
                           ) p
                     GROUP BY p.bucket
                   ) fleet_demand`;
}

// Scoped to internalIds (the whole report scope), not peakInternalIds: the
// per-device map is filtered by role downstream, where a missing device would
// silently become a missing DEMAND row.
function buildDevicePowerPeakSql(request: BoundedEnergySeriesRequest): string {
    const ids = request.internalIds.map(safeInteger).join(',');
    return `SELECT p.device, p.peak_w
              FROM device_em.fn_device_power_peak(
                       ARRAY[${ids}]::integer[],
                       '${request.from.toISOString()}'::timestamptz,
                       '${request.to.toISOString()}'::timestamptz
                   ) p
             ORDER BY p.device`;
}

function buildPhaseSeriesSql(request: BoundedEnergySeriesRequest): string {
    const source = sourceSql(request);
    const metric = quantityMetricOf(request);
    return `SELECT time_bucket('${safeBucket(request.bucket)}', s.bucket) AS bucket,
                   s.device, s.phase,
                   COALESCE(SUM(s.sum_val) FILTER (WHERE s.tag = '${metric.consumptionTag}'), 0) AS consumption_wh,
                   (SUM(s.sum_val) FILTER (WHERE s.tag = 'power')) /
                     NULLIF(SUM(s.sample_count) FILTER (WHERE s.tag = 'power'), 0) AS power_avg,
                   (SUM(s.sum_val) FILTER (WHERE s.tag = 'voltage')) /
                     NULLIF(SUM(s.sample_count) FILTER (WHERE s.tag = 'voltage'), 0) AS voltage_avg,
                   (SUM(s.sum_val) FILTER (WHERE s.tag = 'current')) /
                     NULLIF(SUM(s.sample_count) FILTER (WHERE s.tag = 'current'), 0) AS current_avg
              FROM ${scopedEnergySql(request)} s
             WHERE ${source}
               AND s.phase IN ('a','b','c')
             GROUP BY 1, s.device, s.phase
             ORDER BY 1, s.device, s.phase`;
}

function buildCostSql(request: BoundedEnergySeriesRequest): string {
    const metric = quantityMetricOf(request);
    const returnedFilter = metric.returnedTag
        ? `WHERE s.tag = '${metric.returnedTag}'`
        : 'WHERE FALSE';
    const tags = [
        metric.consumptionTag,
        ...(metric.returnedTag ? [metric.returnedTag] : [])
    ];
    return `SELECT s.bucket, s.device, s.channel,
                   COALESCE(SUM(s.sum_val) FILTER (WHERE s.tag = '${metric.consumptionTag}'), 0) AS consumption_wh,
                   COALESCE(SUM(s.sum_val) FILTER (${returnedFilter}), 0) AS returned_wh
              FROM ${scopedEnergySql(request, tags)} s
             WHERE ${sourceSql(request, tags)}
             GROUP BY s.bucket, s.device, s.channel
             ORDER BY time_bucket('${safeBucket(request.bucket)}', s.bucket),
                      s.device, s.bucket, s.channel`;
}

function buildBatteryMetricsSql(request: BoundedEnergySeriesRequest): string {
    const tags = BATTERY_MEASURED_METRIC_TAGS.map((tag) => `'${tag}'`).join(
        ','
    );
    return `WITH latest AS (
                SELECT DISTINCT ON (s.device, s.tag)
                       s.device, s.tag,
                       s.sum_val / NULLIF(s.sample_count, 0) AS value
                  FROM ${scopedEnergySql(request, BATTERY_MEASURED_METRIC_TAGS)} s
                 WHERE s.bucket >= '${request.from.toISOString()}'::timestamptz
                   AND s.bucket < '${request.to.toISOString()}'::timestamptz
                   AND s.tag IN (${tags})
                   AND s.commodity = 'electricity'
                   AND s.electrical_source IS NOT DISTINCT FROM 'dc_battery'
                 ORDER BY s.device, s.tag, s.bucket DESC
             )
             SELECT tag, AVG(value) AS avg_value,
                    MIN(value) AS min_value, MAX(value) AS max_value
               FROM latest
              GROUP BY tag
              ORDER BY tag`;
}

function metricSql(tag: string): string {
    return `,COALESCE(SUM(s.sum_val) FILTER (WHERE s.tag = '${tag}'), 0) AS ${tag}_sum
            ,COALESCE(SUM(s.sample_count) FILTER (WHERE s.tag = '${tag}'), 0) AS ${tag}_count
            ,MIN(s.min_val) FILTER (WHERE s.tag = '${tag}') AS ${tag}_min
            ,MAX(s.max_val) FILTER (WHERE s.tag = '${tag}') AS ${tag}_max`;
}

// The report scope's rows, without the source channels a custom device in the
// same scope represents, and with the records of EM buckets not rolled yet.
function scopedEnergySql(
    request: BoundedEnergySeriesRequest,
    tags: readonly string[] = reportTags(request)
): string {
    const ids = request.internalIds.map(safeInteger).join(',');
    const tagList = tags.map((tag) => `'${tag}'`).join(',');
    return `device_em.fn_logical_energy_15min_rows(
                ARRAY[${ids}]::integer[],
                '${request.from.toISOString()}'::timestamptz,
                '${request.to.toISOString()}'::timestamptz,
                ARRAY[${tagList}]::varchar(30)[])`;
}

function sourceSql(
    request: BoundedEnergySeriesRequest,
    tags: readonly string[] = reportTags(request)
): string {
    const ids = request.internalIds.map(safeInteger).join(',');
    const tagList = tags.map((tag) => `'${tag}'`).join(',');
    return `s.device = ANY(ARRAY[${ids}]::integer[])
        AND s.bucket >= '${request.from.toISOString()}'::timestamptz
        AND s.bucket < '${request.to.toISOString()}'::timestamptz
        AND s.tag IN (${tagList})
        AND s.commodity = '${quantityMetricOf(request).commodity}'
        ${electricalSourceSql(request)}`;
}

function quantityMetricOf(
    request: BoundedEnergySeriesRequest
): TariffQuantityMetric {
    const metric = request.quantityMetric ?? tariffQuantityMetric({});
    if (!metric) throw new Error('default electricity/kWh quantity is missing');
    return metric;
}

function reportTags(request: BoundedEnergySeriesRequest): readonly string[] {
    const metric = quantityMetricOf(request);
    if (!isElectricityReport(request)) {
        return [
            metric.consumptionTag,
            ...(metric.returnedTag ? [metric.returnedTag] : [])
        ];
    }
    return [
        ...TAGS,
        metric.consumptionTag,
        ...(metric.returnedTag ? [metric.returnedTag] : [])
    ];
}

function isElectricityReport(request: BoundedEnergySeriesRequest): boolean {
    const metric = quantityMetricOf(request);
    return metric.commodity === 'electricity' && metric.billedUnit === 'kWh';
}

function electricalSourceSql(request: BoundedEnergySeriesRequest): string {
    const source =
        request.electricalSource ??
        (quantityMetricOf(request).commodity === 'electricity'
            ? 'ac_mains'
            : null);
    return source
        ? `AND s.electrical_source IS NOT DISTINCT FROM '${safeElectricalSource(source)}'`
        : '';
}

function safeElectricalSource(source: string): string {
    const allowed = new Set<string>(ELECTRICAL_SOURCES);
    if (!allowed.has(source)) {
        throw new Error(`unsafe report electrical source: ${source}`);
    }
    return source;
}

function safeBucket(value: string): string {
    if (!['15 minutes', '1 hour', '1 day', '1 month'].includes(value)) {
        throw new Error(`unsafe report bucket: ${value}`);
    }
    return value;
}

function safeInteger(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`unsafe device id: ${value}`);
    }
    return value;
}

function integer(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
        throw new Error(`invalid integer: ${value}`);
    return parsed;
}

function numeric(value: string | undefined): number {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed)) throw new Error(`invalid number: ${value}`);
    return parsed;
}

function optionalNumeric(value: string | undefined): number | null {
    if (value === undefined || value === '') return null;
    return numeric(value);
}

function roundedOrBlank(value: number | null, digits: number): number | '' {
    return value === null ? '' : +value.toFixed(digits);
}

function phaseLabel(phase: string): string {
    return phase === 'a'
        ? 'L1'
        : phase === 'b'
          ? 'L2'
          : phase === 'c'
            ? 'L3'
            : phase;
}

function assignPhasePower(
    group: PhaseGroup,
    phase: string,
    power: number
): void {
    if (phase === 'L1') group.l1 = power;
    if (phase === 'L2') group.l2 = power;
    if (phase === 'L3') group.l3 = power;
}

function imbalancePct(group: PhaseGroup): number | null {
    const powers = [group.l1, group.l2, group.l3].filter((power) => power > 0);
    if (powers.length < 2) return null;
    const average =
        powers.reduce((sum, power) => sum + power, 0) / powers.length;
    return Math.round(
        (Math.max(...powers.map((power) => Math.abs(power - average))) /
            average) *
            100
    );
}

function emptyScopeCost(): ScopeCost {
    return {consumptionKWh: 0, returnedKWh: 0, cost: 0};
}

function addScopeCost(
    target: ScopeCost,
    consumptionKWh: number,
    returnedKWh: number,
    cost: number
): void {
    target.consumptionKWh += consumptionKWh;
    target.returnedKWh += returnedKWh;
    target.cost += cost;
}

function deviceAggregate(): DeviceAggregate {
    return {
        cons: 0,
        ret: 0,
        cost: 0,
        powerSum: 0,
        powerCount: 0,
        voltSum: 0,
        voltCount: 0,
        currSum: 0,
        currCount: 0
    };
}

function updateDeviceAggregate(
    aggregates: Map<number, DeviceAggregate>,
    device: number,
    input: {
        consumptionKWh: number;
        returnedKWh: number;
        rowCost: number;
        power: number | null;
        voltage: number | null;
        current: number | null;
    }
): void {
    const aggregate = aggregates.get(device) ?? deviceAggregate();
    aggregate.cons += input.consumptionKWh;
    aggregate.ret += input.returnedKWh;
    aggregate.cost += input.rowCost;
    if (input.power !== null) {
        aggregate.powerSum += input.power;
        aggregate.powerCount++;
    }
    if (input.voltage !== null) {
        aggregate.voltSum += input.voltage;
        aggregate.voltCount++;
    }
    if (input.current !== null) {
        aggregate.currSum += input.current;
        aggregate.currCount++;
    }
    aggregates.set(device, aggregate);
}

function updateVoltageRange(
    ranges: Map<number, {min: number; max: number}>,
    device: number,
    min: number | null,
    max: number | null
): void {
    if (min === null && max === null) return;
    const range = ranges.get(device) ?? {min: Infinity, max: -Infinity};
    if (min !== null) range.min = Math.min(range.min, min);
    if (max !== null) range.max = Math.max(range.max, max);
    ranges.set(device, range);
}

interface Totals {
    totalCost: number;
    peakPower: number;
    dayCons: number;
    nightCons: number;
    dayCost: number;
    nightCost: number;
}

function emptyTotals(): Totals {
    return {
        totalCost: 0,
        peakPower: 0,
        dayCons: 0,
        nightCons: 0,
        dayCost: 0,
        nightCost: 0
    };
}

function updateTotals(
    totals: Totals,
    input: {
        consumptionKWh: number;
        rowCost: number;
        power: number | null;
        isDay: boolean;
    }
): void {
    totals.totalCost += input.rowCost;
    if (input.power !== null)
        totals.peakPower = Math.max(totals.peakPower, input.power);
    if (input.isDay) {
        totals.dayCons += input.consumptionKWh;
        totals.dayCost += input.rowCost;
    } else {
        totals.nightCons += input.consumptionKWh;
        totals.nightCost += input.rowCost;
    }
}

interface Compensated {
    sum: number;
    correction: number;
}

function compensatedSum(): Compensated {
    return {sum: 0, correction: 0};
}

function addCompensated(target: Compensated, value: number): void {
    const next = target.sum + value;
    target.correction +=
        Math.abs(target.sum) >= Math.abs(value)
            ? target.sum - next + value
            : value - next + target.sum;
    target.sum = next;
}

function compensatedValue(target: Compensated): number {
    return target.sum + target.correction;
}

function round2(value: number): number {
    return +value.toFixed(2);
}

interface MetricAccumulator {
    sum: number;
    count: number;
    min: number | null;
    max: number | null;
}

function recordMetricAccumulators(): Record<
    (typeof ELECTRICAL_RECORD_METRIC_TAGS)[number],
    MetricAccumulator
> {
    return {
        lag_react_energy: emptyMetricAccumulator(),
        lead_react_energy: emptyMetricAccumulator(),
        fund_act_energy: emptyMetricAccumulator(),
        fund_act_ret_energy: emptyMetricAccumulator(),
        min_apparent_power: emptyMetricAccumulator(),
        max_apparent_power: emptyMetricAccumulator(),
        min_neutral_current: emptyMetricAccumulator(),
        max_neutral_current: emptyMetricAccumulator()
    };
}

function emptyMetricAccumulator(): MetricAccumulator {
    return {sum: 0, count: 0, min: null, max: null};
}

function addMetricAccumulator(
    target: MetricAccumulator,
    value: MetricAccumulator
): void {
    target.sum += value.sum;
    target.count += value.count;
    target.min = minNullable(target.min, value.min);
    target.max = maxNullable(target.max, value.max);
}

function addMetricFromSource(
    target: MetricAccumulator,
    source: Record<string, string>,
    tag: string
): void {
    addMetricAccumulator(target, {
        sum: numeric(source[`${tag}_sum`]),
        count: numeric(source[`${tag}_count`]),
        min: optionalNumeric(source[`${tag}_min`]),
        max: optionalNumeric(source[`${tag}_max`])
    });
}

function metricStat(value: MetricAccumulator): RawStat | null {
    if (value.count <= 0) return null;
    return {
        avg: value.sum / value.count,
        min: value.min,
        max: value.max,
        total: value.sum
    };
}

function minNullable(left: number | null, right: number | null): number | null {
    if (right === null) return left;
    return left === null ? right : Math.min(left, right);
}

function maxNullable(left: number | null, right: number | null): number | null {
    if (right === null) return left;
    return left === null ? right : Math.max(left, right);
}

function buildDataQuality(
    request: BoundedEnergySeriesRequest,
    actualBuckets: ReadonlyMap<number, number>
): DataQualityResult {
    const expected = expectedBucketCount(
        request.from,
        request.to,
        request.bucket
    );
    const perDevice = new Map<number, number>();
    let totalScore = 0;
    for (const device of request.internalIds) {
        const score = Math.min(1, (actualBuckets.get(device) ?? 0) / expected);
        const rounded = +score.toFixed(3);
        perDevice.set(device, rounded);
        totalScore += rounded;
    }
    return {
        overall:
            perDevice.size > 0 ? +(totalScore / perDevice.size).toFixed(3) : 1,
        expectedBucketsPerDevice: expected,
        perDevice
    };
}

function expectedBucketCount(from: Date, to: Date, bucket: string): number {
    if (to.getTime() <= from.getTime()) return 1;
    let cursor = bucketStart(from, bucket);
    const last = bucketStart(new Date(to.getTime() - 1), bucket).getTime();
    let count = 0;
    while (cursor.getTime() <= last) {
        count++;
        cursor = nextBucket(cursor, bucket);
    }
    return Math.max(1, count);
}

function bucketStart(value: Date, bucket: string): Date {
    const date = new Date(value);
    date.setUTCMilliseconds(0);
    date.setUTCSeconds(0);
    if (bucket === '15 minutes') {
        date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 15) * 15);
        return date;
    }
    date.setUTCMinutes(0);
    if (bucket === '1 hour') return date;
    date.setUTCHours(0);
    if (bucket === '1 day') return date;
    date.setUTCDate(1);
    return date;
}

function nextBucket(value: Date, bucket: string): Date {
    const date = new Date(value);
    if (bucket === '15 minutes') {
        date.setUTCMinutes(date.getUTCMinutes() + 15);
    } else if (bucket === '1 hour') {
        date.setUTCHours(date.getUTCHours() + 1);
    } else if (bucket === '1 day') {
        date.setUTCDate(date.getUTCDate() + 1);
    } else {
        date.setUTCMonth(date.getUTCMonth() + 1);
    }
    return date;
}
