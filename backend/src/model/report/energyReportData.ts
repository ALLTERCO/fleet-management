import {getLogger} from 'log4js';
import {tuning} from '../../config';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {defaultEnergyRepository} from '../../modules/repositories/EnergyRepository';
import {listLogicalMeters} from '../../modules/repositories/LogicalMeterRepository';
import {defaultTariffRepository} from '../../modules/repositories/TariffRepository';
import {DAY_MS} from '../../modules/util/timeUnits';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import type {ReportGenerateEnergyParams} from '../../types/api/report';
import type {TariffSpec} from '../../types/api/tariff';
import type CommandSender from '../CommandSender';
import type {EnergyCostResult} from './energyCostEngine';
import {
    assertDashboardOwnedBySender,
    fetchEnergyStatsParallel,
    fetchPriorConsumptionByDevice,
    reportCurrencyFor,
    reportTimezoneFor,
    resolveScopeOnlyForEnergyReport,
    unionGridMeterDevices
} from './energyEngineHelpers';
import {
    buildPhaseAggregation,
    buildTimeSeriesAggregation,
    type PhaseAggregation,
    type TimeSeriesAggregation
} from './energyReportAggregation';
import {runEnergyCostPass} from './energyReportCost';
import {
    computeMeasuredMetrics,
    MEASURED_METRIC_TAGS,
    type MeasuredMetrics
} from './energyReportMeasured';
import {buildMeterBreakdown} from './energyReportMeterBreakdown';
import type {FrequencyStats} from './energyReportPowerQuality';
import {buildPerPointResolver} from './energyReportTariffPoints';
import {
    assertExactlyOneRange,
    GRANULARITY_MAP,
    type ScopeResult
} from './engineHelpers';
import {fetchHourlyProfile} from './hourlyProfileRepo';
import type {LogicalMeterBreakdown} from './logicalMeterUsage';
import {inferPriorWindow} from './periodDeltas';
import {
    computePvEnergy,
    PV_ENERGY_TAGS,
    type PvConfig,
    type PvEnergyResult,
    type PvMode,
    parsePvConfigRow,
    parsePvMode,
    resolvePvMeters
} from './pvEnergy';
import {type PvRoleRefs, pvRefsFromMeters} from './pvFromRoles';
import {resolveReportPeriod} from './reportPeriod';
import {assertReportSafety} from './reportSafety';
import type {RateContext} from './rowEconomics';
import {
    fetchGroupScope,
    fetchLocationScope,
    fetchTagScope,
    type ScopeData
} from './scopeBreakdownRepo';

const logger = getLogger('energyReportData');

type ScopeResolution = Awaited<
    ReturnType<typeof resolveScopeOnlyForEnergyReport>
>;

export interface EnergyReportData {
    orgId: string;
    shellyIDs: string[];
    scope: ScopeResult;
    internalIds: number[];
    deviceMap: Map<number, string>;
    mainMeterSet: Set<string>;
    fromDate: Date;
    toDate: Date;
    priorFrom: Date;
    priorTo: Date;
    currency: string;
    nominalVoltage: number;
    nominalHz: number;
    timezone: string | null;
    priorConsByDevice: Map<number, number>;
    priorTotalCons: number;
    periodDays: number;
    onlineCount: number;
    tariff: TariffSpec | null;
    timeSeries: TimeSeriesAggregation;
    phase: PhaseAggregation;
    frequency: FrequencyStats;
    measured: MeasuredMetrics;
    hourlyConsumedKWh: readonly number[];
    locationScope: ScopeData;
    groupScope: ScopeData;
    tagScope: ScopeData;
    pv: {mode: PvMode; result: PvEnergyResult} | null;
    meterBreakdown: LogicalMeterBreakdown | null;
}

interface BuildEnergyReportDataRequest {
    params: ReportGenerateEnergyParams;
    sender: CommandSender;
}

export async function buildEnergyReportData(
    request: BuildEnergyReportDataRequest
): Promise<EnergyReportData> {
    assertExactlyOneRange(request.params);
    const orgId = requireEnergyReportOrganization(
        request.sender,
        request.params
    );
    // Gate first — dashboard_settings has no org column, so a crafted id could
    // read another tenant's tariff/PV/peak config.
    await assertDashboardOwnedBySender(
        request.params.dashboardId,
        request.sender,
        orgId
    );
    const mainMeterSet = new Set<string>(request.params.main_meter_ids ?? []);

    const resolvedCurrency = await reportCurrencyFor(
        orgId,
        request.params.currency
    );
    const timezone = await reportTimezoneFor(orgId, request.params.timezone);
    const {shellyIDs, scope} = await resolveEnergyScope(request, orgId);
    const {internalIds, deviceMap} = await resolveDeviceMap(shellyIDs);
    // Main meters: explicit config ids + every role=grid logical meter device.
    await unionGridMeterDevices(orgId, mainMeterSet, deviceMap);
    const tariff = await resolveReportTariff(orgId, request.params);
    const currency = tariffDisplayCurrency(
        resolvedCurrency,
        request.params.currency,
        tariff
    );
    // Power-quality nominal V/Hz: per-report override (region/site) else the
    // deployment default. Resolved once here, threaded to both consumers.
    const nominalVoltage =
        request.params.nominalVoltage ?? tuning.report.nominalVoltage;
    const nominalHz = request.params.nominalHz ?? tuning.report.nominalHz;
    const range = reportRange(request.params, timezone);
    assertReportSafety({
        deviceCount: internalIds.length,
        from: range.fromDate,
        to: range.toDate,
        granularity: request.params.granularity ?? 'day',
        seriesCount: 4
    });
    const data = await readEnergySeries({
        params: request.params,
        orgId,
        internalIds,
        deviceMap,
        range,
        timezone,
        tariff
    });
    const pv = await resolvePvForReport({
        params: request.params,
        orgId,
        internalIds,
        deviceMap,
        range
    });
    const meterBreakdown = await buildMeterBreakdown({
        orgId,
        internalIds,
        from: range.fromDate,
        to: range.toDate
    });

    return {
        pv,
        meterBreakdown,
        orgId,
        shellyIDs,
        scope,
        internalIds,
        deviceMap,
        mainMeterSet,
        fromDate: range.fromDate,
        toDate: range.toDate,
        priorFrom: range.priorFrom,
        priorTo: range.priorTo,
        currency,
        timezone,
        tariff,
        nominalVoltage,
        nominalHz,
        ...data,
        periodDays: periodDays(range),
        onlineCount: liveScopedDeviceCount(shellyIDs)
    };
}

// Cost numbers come from the tariff's prices, so the report must display the
// tariff's currency. A caller-pinned currency that differs would mislabel the
// money — we don't convert FX, so fail loud instead of relabeling silently.
function tariffDisplayCurrency(
    resolved: string,
    pinned: string | undefined,
    tariff: TariffSpec | null
): string {
    if (!tariff) return resolved;
    if (pinned && pinned !== tariff.currency) {
        throw RpcError.InvalidParams(
            `Report currency '${pinned}' does not match the tariff currency ` +
                `'${tariff.currency}'. The report bills in the tariff's currency.`
        );
    }
    return tariff.currency;
}

// Resolve the report's tariff: explicit tariff_id wins, else the dashboard's
// stored tariff. Null falls back to inline rate params.
async function resolveReportTariff(
    orgId: string,
    params: ReportGenerateEnergyParams
): Promise<TariffSpec | null> {
    const tariffId = await resolveReportTariffId(params);
    if (tariffId == null) return null;
    const repo = await defaultTariffRepository();
    const tariff = await repo.get(orgId, tariffId);
    // An explicitly-requested tariff that doesn't resolve (deleted, or another
    // org's) must fail loud — silently falling back to the inline rate would
    // bill the report at €0 for a tariff the user named.
    if (!tariff && typeof params.tariff_id === 'number') {
        throw RpcError.NotFound('tariff', String(tariffId));
    }
    return tariff;
}

async function resolveReportTariffId(
    params: ReportGenerateEnergyParams
): Promise<number | null> {
    if (typeof params.tariff_id === 'number') return params.tariff_id;
    if (typeof params.dashboardId === 'number') {
        return dashboardTariffId(params.dashboardId);
    }
    return null;
}

// Peak power is measured over the chosen devices; empty = all. One resolution
// path, two input sources: explicit peak_device_ids param wins, else the
// dashboard's stored selection.
async function resolvePeakDeviceIds(
    request: ReadEnergySeriesRequest
): Promise<number[]> {
    const wanted = await resolvePeakDeviceShellyIds(request.params);
    if (!wanted || wanted.length === 0) return request.internalIds;
    const want = new Set(wanted);
    const filtered = request.internalIds.filter((id) =>
        want.has(request.deviceMap.get(id) ?? '')
    );
    return filtered.length > 0 ? filtered : request.internalIds;
}

async function resolvePeakDeviceShellyIds(
    params: ReportGenerateEnergyParams
): Promise<string[] | null> {
    return peakDeviceSource(params, dashboardPeakDeviceIds);
}

// SSOT precedence rule for the peak-device list: explicit param wins, else the
// dashboard's stored selection, else null (= all devices). Pure over its
// dashboard reader so the rule is testable without a DB.
export async function peakDeviceSource(
    params: Pick<ReportGenerateEnergyParams, 'peak_device_ids' | 'dashboardId'>,
    readDashboard: (dashboardId: number) => Promise<string[] | null>
): Promise<string[] | null> {
    if (params.peak_device_ids) return params.peak_device_ids;
    if (typeof params.dashboardId !== 'number') return null;
    return readDashboard(params.dashboardId);
}

async function dashboardPeakDeviceIds(
    dashboardId: number
): Promise<string[] | null> {
    try {
        const rows = await PostgresProvider.queryRows<{
            peak_device_ids: string[] | null;
        }>(
            'SELECT peak_device_ids FROM ui.dashboard_settings WHERE dashboard_id = $1',
            [dashboardId]
        );
        const v = rows[0]?.peak_device_ids;
        return Array.isArray(v) ? v : null;
    } catch (err) {
        // Best-effort enrichment: fall back to all devices, but surface the
        // failure — never swallow it silently.
        logger.warn(
            'peak-device read failed for dashboard %d (using all devices): %s',
            dashboardId,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

// Resolve + apply the PV config: true house consumption split across grid +
// generation meters per mode. Logical-meter roles are the source of truth;
// the legacy dashboard-JSON refs are the fallback for un-migrated dashboards.
// null when no PV is configured.
async function resolvePvForReport(req: {
    params: ReportGenerateEnergyParams;
    orgId: string;
    internalIds: number[];
    deviceMap: Map<number, string>;
    range: EnergyReportRange;
}): Promise<{mode: PvMode; result: PvEnergyResult} | null> {
    const config = await resolvePvConfig(
        req.orgId,
        req.params.pv_mode,
        req.params.dashboardId,
        req.deviceMap
    );
    if (!config) return null;
    try {
        const repo = await defaultEnergyRepository();
        const rows = await repo.queryChannelEnergyTotals({
            internalIds: req.internalIds,
            from: req.range.fromDate,
            to: req.range.toDate,
            tags: PV_ENERGY_TAGS
        });
        const idOf = invertDeviceMap(req.deviceMap);
        const meters = resolvePvMeters({
            gridRefs: config.gridRefs,
            generationRefs: config.generationRefs,
            rows,
            idOf
        });
        return {
            mode: config.mode,
            result: computePvEnergy({mode: config.mode, ...meters})
        };
    } catch (err) {
        // Best-effort like the config read above: drop only the PV section
        // on a DB error, never fail the whole report.
        logger.warn(
            'PV channel-energy read failed for org %s (PV section skipped): %s',
            req.orgId,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

// Roles first (SSOT), then legacy dashboard refs. Mode is the display switch:
// explicit pv_mode param wins, else the dashboard's. No PV (null) disables the
// summary even with grid+pv meters.
async function resolvePvConfig(
    orgId: string,
    pvModeOverride: PvMode | undefined,
    dashboardId: number | undefined,
    deviceMap: Map<number, string>
): Promise<PvConfig | null> {
    const roleRefs = await pvRefsFromRoles(orgId, deviceMap);
    if (roleRefs) {
        const mode = pvModeOverride ?? (await dashboardPvMode(dashboardId));
        if (mode === null) return null; // PV disabled
        return {mode, ...roleRefs};
    }
    if (typeof dashboardId !== 'number') return null;
    const legacy = await dashboardPvConfig(dashboardId);
    // Legacy refs keep the dashboard's mode unless the report overrides it.
    return legacy && pvModeOverride
        ? {...legacy, mode: pvModeOverride}
        : legacy;
}

async function pvRefsFromRoles(
    orgId: string,
    deviceMap: Map<number, string>
): Promise<PvRoleRefs | null> {
    try {
        const refs = pvRefsFromMeters(
            await listLogicalMeters(orgId),
            deviceMap
        );
        const usable =
            refs.gridRefs.length > 0 && refs.generationRefs.length > 0;
        return usable ? refs : null;
    } catch (err) {
        logger.warn(
            'PV role read failed for org %s (falling back to dashboard config): %s',
            orgId,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

// Dashboard PV mode — the display switch. null = No PV (disabled). No dashboard
// → parallel default; read error → null (drop the section).
async function dashboardPvMode(
    dashboardId: number | undefined
): Promise<PvMode | null> {
    if (typeof dashboardId !== 'number') return 'parallel';
    try {
        const rows = await PostgresProvider.queryRows<{pv_mode: unknown}>(
            'SELECT pv_mode FROM ui.dashboard_settings WHERE dashboard_id = $1',
            [dashboardId]
        );
        return parsePvMode(rows[0]?.pv_mode);
    } catch (err) {
        logger.warn(
            'PV mode read failed for dashboard %d (PV section skipped): %s',
            dashboardId,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

function invertDeviceMap(
    deviceMap: Map<number, string>
): (shellyID: string) => number | undefined {
    const inverse = new Map<string, number>();
    for (const [id, shellyID] of deviceMap) inverse.set(shellyID, id);
    return (shellyID) => inverse.get(shellyID);
}

async function dashboardPvConfig(
    dashboardId: number
): Promise<PvConfig | null> {
    try {
        const rows = await PostgresProvider.queryRows<{
            pv_mode: unknown;
            pv_grid_refs: unknown;
            pv_generation_refs: unknown;
        }>(
            'SELECT pv_mode, pv_grid_refs, pv_generation_refs FROM ui.dashboard_settings WHERE dashboard_id = $1',
            [dashboardId]
        );
        return parsePvConfigRow(rows[0]);
    } catch (err) {
        logger.warn(
            'PV config read failed for dashboard %d (PV section skipped): %s',
            dashboardId,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

async function dashboardTariffId(dashboardId: number): Promise<number | null> {
    try {
        const rows = await PostgresProvider.queryRows<{
            tariff_id: number | null;
        }>(
            'SELECT tariff_id FROM ui.dashboard_settings WHERE dashboard_id = $1',
            [dashboardId]
        );
        return rows[0]?.tariff_id ?? null;
    } catch (err) {
        // Best-effort: fall back to inline rates, but log the failure.
        logger.warn(
            'tariff_id read failed for dashboard %d (using inline rates): %s',
            dashboardId,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

function requireEnergyReportOrganization(
    sender: CommandSender,
    params: ReportGenerateEnergyParams
): string {
    return requireOrganizationId(sender, {
        organizationId: (params as {organizationId?: string}).organizationId
    });
}

async function resolveEnergyScope(
    request: BuildEnergyReportDataRequest,
    orgId: string
): Promise<ScopeResolution> {
    return resolveScopeOnlyForEnergyReport(
        request.params.scope,
        request.sender,
        orgId
    );
}

async function resolveDeviceMap(
    shellyIDs: readonly string[]
): Promise<{internalIds: number[]; deviceMap: Map<number, string>}> {
    const {internalIds, idMap} = await PostgresProvider.resolveDeviceIds([
        ...shellyIDs
    ]);
    if (!internalIds.length) throw RpcError.NotFound('device_ids');
    return {
        internalIds,
        deviceMap: new Map(Object.entries(idMap).map(([k, v]) => [+k, v]))
    };
}

interface EnergyReportRange {
    fromDate: Date;
    toDate: Date;
    priorFrom: Date;
    priorTo: Date;
}

// Resolve the report window: a named `period` (tz-aware, server-resolved) wins;
// otherwise the explicit from/to. The prior window is always inferred from the
// resolved range, so period-over-period deltas keep working for either input.
function reportRange(
    params: ReportGenerateEnergyParams,
    timezone: string | null
): EnergyReportRange {
    const {fromDate, toDate} = params.period
        ? resolvedPeriodRange(params, timezone)
        : {fromDate: new Date(params.from), toDate: new Date(params.to)};
    const {priorFrom, priorTo} = inferPriorWindow({
        from: fromDate,
        to: toDate
    });
    return {fromDate, toDate, priorFrom, priorTo};
}

function resolvedPeriodRange(
    params: ReportGenerateEnergyParams,
    timezone: string | null
): {fromDate: Date; toDate: Date} {
    if (!params.period) throw RpcError.InvalidParams('period is required');
    const {from, to} = resolveReportPeriod(
        params.period,
        new Date(),
        timezone,
        {
            billingDay: params.billing_day
        }
    );
    return {fromDate: from, toDate: to};
}

interface ReadEnergySeriesRequest {
    params: ReportGenerateEnergyParams;
    orgId: string;
    internalIds: number[];
    deviceMap: Map<number, string>;
    range: EnergyReportRange;
    timezone: string | null;
    tariff: TariffSpec | null;
}

async function readEnergySeries(request: ReadEnergySeriesRequest): Promise<{
    priorConsByDevice: Map<number, number>;
    priorTotalCons: number;
    timeSeries: TimeSeriesAggregation;
    phase: PhaseAggregation;
    frequency: FrequencyStats;
    measured: MeasuredMetrics;
    hourlyConsumedKWh: readonly number[];
    locationScope: ScopeData;
    groupScope: ScopeData;
    tagScope: ScopeData;
}> {
    const bucket = reportBucket(request.params);
    const rate = rateContext(request.params, request.timezone);
    const repo = await defaultEnergyRepository();
    const peakIds = await resolvePeakDeviceIds(request);
    const [
        {combinedRep, phaseRep},
        priorConsByDevice,
        cost,
        peakW,
        frequency,
        metricStats,
        hourlyProfile,
        locationScope,
        groupScope,
        tagScope
    ] = await Promise.all([
        fetchEnergyStatsParallel(
            request.internalIds,
            request.range.fromDate,
            request.range.toDate,
            bucket
        ),
        fetchPriorConsumptionByDevice(
            request.internalIds,
            request.range.priorFrom,
            request.range.priorTo,
            bucket
        ),
        timeVaryingCostPass(request, rate, repo),
        repo.queryPeakPowerW({
            internalIds: peakIds,
            from: request.range.fromDate,
            to: request.range.toDate
        }),
        repo.queryFrequencyStats({
            internalIds: request.internalIds,
            from: request.range.fromDate,
            to: request.range.toDate
        }),
        // Best-effort: the measured section is an extra — never fail the report.
        repo
            .queryMetricStats({
                internalIds: request.internalIds,
                from: request.range.fromDate,
                to: request.range.toDate,
                tags: MEASURED_METRIC_TAGS
            })
            .catch((err): Awaited<ReturnType<typeof repo.queryMetricStats>> => {
                logger.warn(
                    'metric stats read failed for %d devices (measured section skipped): %s',
                    request.internalIds.length,
                    err instanceof Error ? err.message : String(err)
                );
                return new Map();
            }),
        fetchHourlyProfile({
            deviceIds: request.internalIds,
            from: request.range.fromDate,
            to: request.range.toDate,
            timezone: request.timezone ?? undefined
        }),
        fetchLocationScope(request.orgId, [...request.deviceMap.values()]),
        fetchGroupScope(request.orgId, [...request.deviceMap.values()]),
        fetchTagScope(request.orgId, [...request.deviceMap.values()])
    ]);
    const timeSeries = buildTimeSeriesAggregation({
        rows: combinedRep.rows ?? [],
        deviceMap: request.deviceMap,
        rate,
        cost: cost ?? undefined,
        granularity: request.params.granularity ?? 'day'
    });
    // True peak from 15-min maxes, not a smoothed bucket average.
    if (typeof peakW === 'number') timeSeries.peakPower = +peakW.toFixed(1);
    return {
        priorConsByDevice,
        priorTotalCons: totalPriorConsumption(priorConsByDevice),
        timeSeries,
        phase: buildPhaseAggregation({
            rows: phaseRep.rows ?? [],
            deviceMap: request.deviceMap
        }),
        frequency,
        measured: computeMeasuredMetrics(metricStats),
        hourlyConsumedKWh: hourlyProfile.consumedKWh,
        locationScope,
        groupScope,
        tagScope
    };
}

// Cost pass over 15-min pieces — for time-varying tariffs or a stored tariff.
// A flat inline rate is already correct per display bucket, so it is skipped.
async function timeVaryingCostPass(
    request: ReadEnergySeriesRequest,
    rate: RateContext,
    repo: Awaited<ReturnType<typeof defaultEnergyRepository>>
): Promise<EnergyCostResult | null> {
    // Per-channel/device assignments (monophase) override the single tariff.
    const resolverOverride = await buildPerPointResolver({
        orgId: request.orgId,
        deviceMap: request.deviceMap,
        defaultTariff: request.tariff,
        from: request.range.fromDate,
        to: request.range.toDate,
        rate
    });
    // Flat inline rate with no tariff and no assignments is already correct.
    if (rate.tariffMode === 'single' && !request.tariff && !resolverOverride) {
        return null;
    }
    return runEnergyCostPass({
        repo,
        internalIds: request.internalIds,
        from: request.range.fromDate,
        to: request.range.toDate,
        granularity: request.params.granularity ?? 'day',
        rate,
        tariff: request.tariff,
        resolverOverride
    });
}

function reportBucket(params: ReportGenerateEnergyParams): string {
    const bucket = GRANULARITY_MAP[params.granularity ?? 'day'];
    if (!bucket) throw RpcError.InvalidParams('Invalid granularity');
    return bucket;
}

function rateContext(
    params: ReportGenerateEnergyParams,
    timezone: string | null
): RateContext {
    return {
        tariffMode: params.tariff_mode ?? 'single',
        tariff: params.tariff ?? 0,
        dayRate: params.day_rate ?? 0,
        nightRate: params.night_rate ?? 0,
        dayStartHour: hourFractionOf(params.day_start ?? '07:00:00'),
        dayEndHour: hourFractionOf(params.day_end ?? '23:00:00'),
        timezone
    };
}

// Fractional hour-of-day so a 07:30 tariff boundary keeps its minutes instead
// of truncating to 07:00 and misbilling that half hour.
function hourFractionOf(time: string): number {
    const [h, m] = time.split(':');
    return Number.parseInt(h, 10) + Number.parseInt(m ?? '0', 10) / 60;
}

function totalPriorConsumption(prior: ReadonlyMap<number, number>): number {
    return [...prior.values()].reduce((sum, value) => sum + value, 0);
}

function periodDays(
    input: Pick<EnergyReportRange, 'fromDate' | 'toDate'>
): number {
    return Math.max(
        1,
        (input.toDate.getTime() - input.fromDate.getTime()) / DAY_MS
    );
}

function liveScopedDeviceCount(shellyIDs: readonly string[]): number {
    const scopedShellyIDs = new Set(shellyIDs);
    return DeviceCollector.getAll().filter((device) =>
        scopedShellyIDs.has(device.shellyID)
    ).length;
}
