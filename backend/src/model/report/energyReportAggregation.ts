import type {EnergyStatsRow} from '../../modules/repositories/EnergyRepository';
import type {PhaseGroup} from './anomalies';
import type {EnergyCostResult} from './energyCostEngine';
import type {DeviceAggregate} from './energyEngineHelpers';
import {displayBucketKey} from './energyReportCost';
import {deviceDisplayName} from './engineHelpers';
import {deriveRowEconomics, type RateContext, whToKWh} from './rowEconomics';

type ReportRow = Record<string, any>;

export interface TimeSeriesAggregationRequest {
    rows: readonly EnergyStatsRow[];
    deviceMap: Map<number, string>;
    rate: RateContext;
    // When set (time-varying tariffs), overrides cost from the 15-min pass.
    cost?: EnergyCostResult;
    granularity?: string;
}

export interface TimeSeriesAggregation {
    tsRows: ReportRow[];
    deviceAgg: Map<number, DeviceAggregate>;
    totalCons: number;
    totalRet: number;
    totalCost: number;
    peakPower: number;
    avgVoltage: number;
    dayCons: number;
    nightCons: number;
    dayCost: number;
    nightCost: number;
    estimatedKWh: number; // consumption priced from a tariff feed gap (VEE)
}

interface TimeSeriesBuildState {
    tsDeviceIds: Map<string, number>;
    tsMap: Map<string, ReportRow>;
}

type TagApplier = (row: ReportRow, value: number) => void;

const TIME_SERIES_TAGS: Record<string, TagApplier> = {
    total_act_energy: (row, value) => {
        row.consumption_kwh = whToKWh(value);
    },
    total_act_ret_energy: (row, value) => {
        row.returned_kwh = whToKWh(value);
    },
    power: (row, value) => {
        row.power_avg_w = +value.toFixed(1);
    },
    voltage: (row, value) => {
        row.voltage_avg_v = +value.toFixed(2);
    },
    min_voltage: (row, value) => {
        row.voltage_min_v = +value.toFixed(2);
    },
    max_voltage: (row, value) => {
        row.voltage_max_v = +value.toFixed(2);
    },
    current: (row, value) => {
        row.current_avg_a = +value.toFixed(3);
    },
    max_current: (row, value) => {
        row.current_max_a = +value.toFixed(3);
    },
    power_factor: (row, value) => {
        row.power_factor_avg = +value.toFixed(3);
    }
};

export function buildTimeSeriesAggregation(
    request: TimeSeriesAggregationRequest
): TimeSeriesAggregation {
    const state = buildTimeSeriesRows(request);
    const agg = applyTimeSeriesEconomics({
        state,
        rate: request.rate,
        tariffMode: request.rate.tariffMode
    });
    if (request.cost) {
        spliceCostResult(agg, request.cost, request.granularity ?? 'day');
    }
    return agg;
}

function round2(value: number): number {
    return +value.toFixed(2);
}

// Replace cost fields with the 15-min cost pass (correct day/night split).
// Energy/power/voltage aggregates are unchanged.
function spliceCostResult(
    agg: TimeSeriesAggregation,
    cost: EnergyCostResult,
    granularity: string
): void {
    agg.totalCost = round2(cost.totals.cost);
    agg.estimatedKWh = cost.estimatedKWh;
    agg.dayCons = cost.totals.dayConsumptionKWh;
    agg.nightCons = cost.totals.nightConsumptionKWh;
    agg.dayCost = cost.totals.dayCost;
    agg.nightCost = cost.totals.nightCost;
    for (const row of agg.tsRows) {
        const id = row._deviceId as number;
        const hit = cost.perDisplayBucket.get(
            displayBucketKey(row.date, granularity, id)
        );
        if (hit) row.cost = round2(hit.cost);
    }
    for (const [id, dev] of agg.deviceAgg) {
        const hit = cost.perDevice.get(id);
        if (hit) dev.cost = round2(hit.cost);
    }
}

function buildTimeSeriesRows(
    request: TimeSeriesAggregationRequest
): TimeSeriesBuildState {
    const state: TimeSeriesBuildState = {
        tsDeviceIds: new Map(),
        tsMap: new Map()
    };
    for (const row of request.rows) {
        const reportRow = timeSeriesRowFor({
            row,
            deviceMap: request.deviceMap,
            state
        });
        TIME_SERIES_TAGS[row.tag]?.(reportRow, row.agg_value ?? 0);
    }
    return state;
}

function timeSeriesRowFor(request: {
    row: EnergyStatsRow;
    deviceMap: Map<number, string>;
    state: TimeSeriesBuildState;
}): ReportRow {
    const key = `${request.row.bucket}::${request.row.device}`;
    if (!request.state.tsMap.has(key)) {
        request.state.tsDeviceIds.set(key, request.row.device);
        const row: ReportRow = {
            date: request.row.bucket,
            device: deviceDisplayName(request.row.device, request.deviceMap),
            consumption_kwh: 0,
            returned_kwh: 0,
            net_kwh: 0,
            power_avg_w: '',
            voltage_avg_v: '',
            voltage_min_v: '',
            voltage_max_v: '',
            current_avg_a: '',
            current_max_a: '',
            cost: 0
        };
        // Non-enumerable: read by the cost splice, invisible to equality/JSON.
        Object.defineProperty(row, '_deviceId', {value: request.row.device});
        request.state.tsMap.set(key, row);
    }
    return request.state.tsMap.get(key)!;
}

interface EconomicsRequest {
    state: TimeSeriesBuildState;
    rate: RateContext;
    tariffMode: string;
}

function applyTimeSeriesEconomics(
    request: EconomicsRequest
): TimeSeriesAggregation {
    const totals = emptyTimeSeriesTotals();
    const voltageValues: number[] = [];
    const deviceAgg = new Map<number, DeviceAggregate>();
    for (const [key, row] of request.state.tsMap.entries()) {
        const deviceId = request.state.tsDeviceIds.get(key)!;
        applyRowEconomics({
            row,
            deviceId,
            rate: request.rate,
            tariffMode: request.tariffMode,
            totals,
            voltageValues,
            deviceAgg
        });
    }
    return {
        ...totals,
        avgVoltage: averageVoltage(voltageValues),
        deviceAgg,
        tsRows: sortedReportRows(request.state.tsMap),
        estimatedKWh: 0
    };
}

interface TimeSeriesTotals {
    totalCons: number;
    totalRet: number;
    totalCost: number;
    peakPower: number;
    dayCons: number;
    nightCons: number;
    dayCost: number;
    nightCost: number;
}

function emptyTimeSeriesTotals(): TimeSeriesTotals {
    return {
        totalCons: 0,
        totalRet: 0,
        totalCost: 0,
        peakPower: 0,
        dayCons: 0,
        nightCons: 0,
        dayCost: 0,
        nightCost: 0
    };
}

interface RowEconomicsRequest {
    row: ReportRow;
    deviceId: number;
    rate: RateContext;
    tariffMode: string;
    totals: TimeSeriesTotals;
    voltageValues: number[];
    deviceAgg: Map<number, DeviceAggregate>;
}

function applyRowEconomics(request: RowEconomicsRequest): void {
    const consumptionKWh = numberOrZero(request.row.consumption_kwh);
    const returnedKWh = numberOrZero(request.row.returned_kwh);
    const economics = deriveRowEconomics({
        consumptionKWh,
        returnedKWh,
        bucketDate: request.row.date,
        rate: request.rate
    });
    request.row.net_kwh = economics.netKWh;
    request.row.cost = economics.cost;
    updateTariffTotals({
        request,
        rate: economics.rate,
        consumptionKWh,
        isDay: economics.isDay
    });
    updateEnergyTotals({
        request,
        consumptionKWh,
        returnedKWh,
        rate: economics.rate
    });
    updateDeviceAggregate({
        request,
        consumptionKWh,
        returnedKWh,
        rate: economics.rate
    });
}

function updateTariffTotals(input: {
    request: RowEconomicsRequest;
    rate: number;
    consumptionKWh: number;
    isDay: boolean;
}): void {
    if (input.request.tariffMode !== 'day_night') return;
    if (input.isDay) {
        input.request.totals.dayCons += input.consumptionKWh;
        input.request.totals.dayCost += input.consumptionKWh * input.rate;
        return;
    }
    input.request.totals.nightCons += input.consumptionKWh;
    input.request.totals.nightCost += input.consumptionKWh * input.rate;
}

function updateEnergyTotals(input: {
    request: RowEconomicsRequest;
    consumptionKWh: number;
    returnedKWh: number;
    rate: number;
}): void {
    input.request.totals.totalCons += input.consumptionKWh;
    input.request.totals.totalRet += input.returnedKWh;
    input.request.totals.totalCost += input.consumptionKWh * input.rate;
    if (
        typeof input.request.row.power_avg_w === 'number' &&
        input.request.row.power_avg_w > input.request.totals.peakPower
    ) {
        input.request.totals.peakPower = input.request.row.power_avg_w;
    }
    if (typeof input.request.row.voltage_avg_v === 'number') {
        input.request.voltageValues.push(input.request.row.voltage_avg_v);
    }
}

function updateDeviceAggregate(input: {
    request: RowEconomicsRequest;
    consumptionKWh: number;
    returnedKWh: number;
    rate: number;
}): void {
    const aggregate = deviceAggregateFor(
        input.request.deviceId,
        input.request.deviceAgg
    );
    aggregate.cons += input.consumptionKWh;
    aggregate.ret += input.returnedKWh;
    aggregate.cost += input.consumptionKWh * input.rate;
    addAverageSamples(aggregate, input.request.row);
}

function deviceAggregateFor(
    deviceId: number,
    deviceAgg: Map<number, DeviceAggregate>
): DeviceAggregate {
    const existing = deviceAgg.get(deviceId);
    if (existing) return existing;
    const created = {
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
    deviceAgg.set(deviceId, created);
    return created;
}

function addAverageSamples(aggregate: DeviceAggregate, row: ReportRow): void {
    if (typeof row.power_avg_w === 'number') {
        aggregate.powerSum += row.power_avg_w;
        aggregate.powerCount++;
    }
    if (typeof row.voltage_avg_v === 'number') {
        aggregate.voltSum += row.voltage_avg_v;
        aggregate.voltCount++;
    }
    if (typeof row.current_avg_a === 'number') {
        aggregate.currSum += row.current_avg_a;
        aggregate.currCount++;
    }
}

export interface PhaseAggregationRequest {
    rows: readonly EnergyStatsRow[];
    deviceMap: Map<number, string>;
}

export interface PhaseAggregation {
    phaseRows: ReportRow[];
    phaseGroups: Map<string, PhaseGroup>;
}

const PHASE_LABELS: Record<string, string> = {
    a: 'L1',
    b: 'L2',
    c: 'L3'
};

const PHASE_TAGS: Record<string, TagApplier> = {
    total_act_energy: (row, value) => {
        row.consumption_kwh = whToKWh(value);
    },
    power: (row, value) => {
        row.power_w = +value.toFixed(1);
    },
    voltage: (row, value) => {
        row.voltage_v = +value.toFixed(2);
    },
    current: (row, value) => {
        row.current_a = +value.toFixed(3);
    }
};

export function buildPhaseAggregation(
    request: PhaseAggregationRequest
): PhaseAggregation {
    const phaseMap = new Map<string, ReportRow>();
    for (const row of request.rows) {
        if (!row.phase || row.phase === 'z') continue;
        const reportRow = phaseRowFor({
            row,
            deviceMap: request.deviceMap,
            phaseMap
        });
        PHASE_TAGS[row.tag]?.(reportRow, row.agg_value ?? 0);
    }
    const phaseRows = sortedPhaseRows(phaseMap);
    return {phaseRows, phaseGroups: buildPhaseGroups(phaseRows)};
}

function phaseRowFor(input: {
    row: EnergyStatsRow;
    deviceMap: Map<number, string>;
    phaseMap: Map<string, ReportRow>;
}): ReportRow {
    const key = `${input.row.bucket}::${input.row.device}::${input.row.phase}`;
    if (!input.phaseMap.has(key)) {
        input.phaseMap.set(key, {
            date: input.row.bucket,
            device: deviceDisplayName(input.row.device, input.deviceMap),
            phase: PHASE_LABELS[input.row.phase ?? ''] ?? input.row.phase,
            consumption_kwh: 0,
            power_w: '',
            voltage_v: '',
            current_a: ''
        });
    }
    return input.phaseMap.get(key)!;
}

function buildPhaseGroups(rows: readonly ReportRow[]): Map<string, PhaseGroup> {
    const groups = new Map<string, PhaseGroup>();
    for (const row of rows) {
        if (typeof row.power_w !== 'number') continue;
        const group = phaseGroupFor(row, groups);
        assignPhasePower({group, phase: row.phase, powerWatts: row.power_w});
    }
    return groups;
}

function phaseGroupFor(
    row: ReportRow,
    groups: Map<string, PhaseGroup>
): PhaseGroup {
    const groupKey = `${row.date}::${row.device}`;
    const existing = groups.get(groupKey);
    if (existing) return existing;
    const created = {l1: 0, l2: 0, l3: 0};
    groups.set(groupKey, created);
    return created;
}

function assignPhasePower(input: {
    group: PhaseGroup;
    phase: unknown;
    powerWatts: number;
}): void {
    const key = String(input.phase).toLowerCase();
    if (key === 'l1') input.group.l1 = input.powerWatts;
    if (key === 'l2') input.group.l2 = input.powerWatts;
    if (key === 'l3') input.group.l3 = input.powerWatts;
}

function sortedReportRows(map: Map<string, ReportRow>): ReportRow[] {
    return [...map.values()].sort(
        (a, b) =>
            String(a.date).localeCompare(String(b.date)) ||
            String(a.device).localeCompare(String(b.device))
    );
}

function sortedPhaseRows(map: Map<string, ReportRow>): ReportRow[] {
    return [...map.values()].sort(
        (a, b) =>
            String(a.date).localeCompare(String(b.date)) ||
            String(a.device).localeCompare(String(b.device)) ||
            String(a.phase).localeCompare(String(b.phase))
    );
}

function averageVoltage(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
}

function numberOrZero(value: unknown): number {
    return typeof value === 'number' ? value : 0;
}
