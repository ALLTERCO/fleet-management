import {getLogger} from 'log4js';
import {tuning} from '../../config';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {
    defaultEnergyRepository,
    rollupBacklogTotal
} from '../../modules/repositories/EnergyRepository';
import {defaultGasConversionRepository} from '../../modules/repositories/GasConversionRepository';
import {
    listLogicalMeterMeanings,
    listLogicalMeters
} from '../../modules/repositories/LogicalMeterRepository';
import {defaultTariffRepository} from '../../modules/repositories/TariffRepository';
import {DAY_MS} from '../../modules/util/timeUnits';
import {queryLogicalChannelEnergyTotals} from '../../modules/virtualDevice/logicalEnergy';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import type {
    EnergyIncompleteRange,
    EnergyLogicalMeter,
    EnergyLogicalMeterMeaning,
    EnergySyncStatusResponse
} from '../../types/api/energy';
import type {ReportGenerateEnergyParams} from '../../types/api/report';
import type {TariffSpec} from '../../types/api/tariff';
import {meteredRowsOrZero, readMeteredZeroRows} from '../billing/meteredZero';
import type CommandSender from '../CommandSender';
import {loadEnergySyncStatus} from '../energy/syncStatusHandler';
import type {CostPriceResolver} from './energyCostEngine';
import {
    assertDashboardOwnedBySender,
    assertExclusiveEnergyReportScope,
    fetchPriorConsumptionByDevice,
    reportCurrencyFor,
    reportTimezoneFor,
    resolveLocationIdsForEnergyReport,
    resolveScopeOnlyForEnergyReport,
    unionGridMeterDevices
} from './energyEngineHelpers';
import {
    type BoundedPhaseAggregation,
    type BoundedTimeSeriesAggregation,
    buildBoundedEnergySeries
} from './energyReportBoundedSeries';
import {
    publicIncompleteRanges,
    requireCompleteRollup,
    requireNoIncompleteRanges
} from './energyReportCompleteness';
import {
    buildCostPriceResolver,
    buildEnergyCostRows,
    type QuantityCoverageInterval,
    resolveQuantityCoverageInterval
} from './energyReportCost';
import {
    type EnergyReportFeedInPricing,
    readEnergyReportFeedInPricing
} from './energyReportFeedIn';
import type {MeasuredMetrics} from './energyReportMeasured';
import {buildMeterBreakdown} from './energyReportMeterBreakdown';
import type {FrequencyStats} from './energyReportPowerQuality';
import {buildPerPointResolver} from './energyReportTariffPoints';
import {
    assertExactlyOneRange,
    GRANULARITY_MAP,
    type ScopeResult
} from './engineHelpers';
import type {GasConversionDisclosure} from './gasConversion';
import {prepareGasReportConversion} from './gasReportConversion';
import {fetchHourlyProfile} from './hourlyProfileRepo';
import {dateInZone} from './localTimeInZone';
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
import {
    createReportCancelPoller,
    type ReportJobContext
} from './reportJobContext';
import {
    localMidnightToUtc,
    resolveReportPeriod,
    shiftMonth
} from './reportPeriod';
import {assertReportSafety} from './reportSafety';
import type {RateContext} from './rowEconomics';
import {
    fetchGroupScope,
    fetchLocationScope,
    fetchTagScope,
    type ScopeData
} from './scopeBreakdownRepo';
import type {
    TariffDemandDeviceSample,
    TariffDemandSample
} from './tariffDemandCharges';
import {
    defaultBilledUnit,
    quantityMetric,
    rawQuantityMetric,
    type TariffQuantityMetric,
    tariffBilledUnit,
    tariffCommodity
} from './tariffQuantity';

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
    commodity: TariffQuantityMetric['commodity'];
    billedUnit: TariffQuantityMetric['billedUnit'];
    coverage: QuantityCoverageInterval;
    demandSamples: readonly TariffDemandSample[];
    demandDeviceSamples: readonly TariffDemandDeviceSample[];
    timeSeries: BoundedTimeSeriesAggregation;
    phase: BoundedPhaseAggregation;
    frequency: FrequencyStats;
    measured: MeasuredMetrics;
    hourlyConsumedKWh: readonly number[];
    locationScope: ScopeData;
    groupScope: ScopeData;
    tagScope: ScopeData;
    pv: {mode: PvMode; result: PvEnergyResult} | null;
    meterBreakdown: LogicalMeterBreakdown | null;
    /** Persisted sell/export pricing, kept independent from the import tariff. */
    feedInPricing: EnergyReportFeedInPricing | null;
    /** Exact profile/CV revisions used to turn metered gas into billed energy. */
    gasConversions: readonly GasConversionDisclosure[];
    syncStatus: EnergySyncStatusResponse;
    /** Open incomplete meter-history ranges inside the report period. */
    incompleteRanges: EnergyIncompleteRange[];
    cleanup(): Promise<void>;
}

interface BuildEnergyReportDataRequest {
    params: ReportGenerateEnergyParams;
    sender: CommandSender;
    /** Present for a background job: carries progress and the cancel marker. */
    context?: ReportJobContext;
}

/** Who, when and what quantity a report covers, before anything expensive is
 *  read. */
export interface EnergyReportTarget {
    orgId: string;
    shellyIDs: string[];
    scope: ScopeResult;
    internalIds: number[];
    deviceMap: Map<number, string>;
    timezone: string | null;
    range: EnergyReportRange;
    tariff: TariffSpec | null;
    /** The billed quantity the report will present. */
    quantityMetric: TariffQuantityMetric;
    /** The stored quantity the rollup actually holds for it. */
    rawQuantityMetric: TariffQuantityMetric;
}

/**
 * Authorize the request and resolve its devices and window. The pre-flight
 * coverage probe and the full build share this one path so the period a job is
 * refused for is exactly the period it would have read.
 */
export async function resolveEnergyReportTarget(
    request: BuildEnergyReportDataRequest
): Promise<EnergyReportTarget> {
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
    const timezone = await reportTimezoneFor(orgId, request.params.timezone);
    const {shellyIDs, scope} = await resolveEnergyScope(request, orgId);
    const {internalIds, deviceMap} = await resolveDeviceMap(shellyIDs);
    const tariff = await resolveReportTariff(orgId, request.params);
    const quantity = resolveReportQuantity(request.params, tariff);
    const raw = rawQuantityMetric(quantity);
    if (!raw) {
        throw RpcError.Domain('ValidationFailed', {
            message: 'The report has no supported raw quantity for conversion.',
            field: 'billedUnit'
        });
    }
    return {
        orgId,
        shellyIDs,
        scope,
        internalIds,
        deviceMap,
        timezone,
        range: reportRange(request.params, timezone),
        tariff,
        quantityMetric: quantity,
        rawQuantityMetric: raw
    };
}

export async function buildEnergyReportData(
    request: BuildEnergyReportDataRequest
): Promise<EnergyReportData> {
    const target = await resolveEnergyReportTarget(request);
    // Scope, tariff and window are resolved; nothing large has been read yet.
    await request.context?.throwIfCancelled();
    const {orgId, shellyIDs, scope, internalIds, deviceMap, timezone, range} =
        target;
    const tariff = target.tariff;
    const reportQuantity = target.quantityMetric;
    const mainMeterSet = new Set<string>(request.params.main_meter_ids ?? []);

    const resolvedCurrency = await reportCurrencyFor(
        orgId,
        request.params.currency
    );
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
    await assertNoScopedMeaningBoundary(
        orgId,
        internalIds,
        range.fromDate,
        range.toDate
    );
    // Historical runs resolve the grid role at the report boundary, never at
    // today's meaning. The detailed meter breakdown splits every 15m bucket.
    await unionGridMeterDevices(
        orgId,
        mainMeterSet,
        deviceMap,
        undefined,
        range.fromDate
    );
    assertReportSafety({
        deviceCount: internalIds.length,
        from: range.fromDate,
        to: range.toDate,
        granularity: request.params.granularity ?? 'day',
        seriesCount: 4
    });
    const repo = await defaultEnergyRepository();
    const idMap = Object.fromEntries(deviceMap) as Record<number, string>;
    let syncStatus = await loadEnergySyncStatus({
        internalIds,
        idMap,
        repo,
        lookup: (shellyID) => DeviceCollector.getDevice(shellyID)
    });
    const rollupScope = {
        internalIds,
        from: range.fromDate,
        to: range.toDate
    };
    const scopedBacklog = await repo.queryRollupBacklogInScope(
        internalIds,
        range.fromDate,
        range.toDate
    );
    const scopedRollupPending = rollupBacklogTotal(scopedBacklog);
    const incompleteRanges = publicIncompleteRanges(
        await repo.queryEmIncompleteRanges(
            internalIds,
            range.fromDate,
            range.toDate
        ),
        idMap
    );
    syncStatus = {
        ...syncStatus,
        complete:
            syncStatus.devicesCatchingUp === 0 &&
            scopedRollupPending === 0 &&
            incompleteRanges.length === 0,
        rollupPendingBuckets: scopedRollupPending,
        rollupScheduledBuckets: scopedBacklog.scheduled,
        provisional: scopedBacklog.scheduled > 0
    };
    if (request.params.require_complete_data) {
        requireNoIncompleteRanges(incompleteRanges);
    }
    if (
        request.params.require_complete_data &&
        syncStatus.devicesCatchingUp > 0
    ) {
        throw RpcError.Domain('ServiceUnavailable', {
            message:
                `${syncStatus.devicesCatchingUp} energy devices are still ` +
                'syncing historical data'
        });
    }
    if (request.params.require_complete_data && scopedRollupPending > 0) {
        await requireCompleteRollup(repo, rollupScope, scopedBacklog);
        syncStatus = await loadEnergySyncStatus({
            internalIds,
            idMap,
            repo,
            lookup: (shellyID) => DeviceCollector.getDevice(shellyID)
        });
        syncStatus = {
            ...syncStatus,
            complete:
                syncStatus.devicesCatchingUp === 0 &&
                incompleteRanges.length === 0,
            rollupPendingBuckets: 0,
            rollupScheduledBuckets: scopedBacklog.scheduled,
            provisional: scopedBacklog.scheduled > 0
        };
    }
    // Meaning, grid-role and sync resolution are done; the long read is next.
    await request.context?.throwIfCancelled();
    const data = await readEnergySeries({
        params: request.params,
        orgId,
        internalIds,
        deviceMap,
        range,
        timezone,
        tariff,
        currency,
        quantityMetric: reportQuantity,
        context: request.context
    });
    let pv: Awaited<ReturnType<typeof resolvePvForReport>>;
    let meterBreakdown: Awaited<ReturnType<typeof buildMeterBreakdown>>;
    try {
        pv =
            data.coverage.status === 'complete' &&
            reportQuantity.commodity === 'electricity' &&
            reportQuantity.billedUnit === 'kWh'
                ? await resolvePvForReport({
                      params: request.params,
                      orgId,
                      internalIds,
                      deviceMap,
                      range
                  })
                : null;
        meterBreakdown =
            data.coverage.status === 'complete'
                ? await buildMeterBreakdown({
                      orgId,
                      internalIds,
                      from: range.fromDate,
                      to: range.toDate
                  })
                : null;
    } catch (error) {
        await data.cleanup();
        throw error;
    }

    return {
        pv,
        meterBreakdown,
        syncStatus,
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
        commodity: reportQuantity.commodity,
        billedUnit: reportQuantity.billedUnit,
        nominalVoltage,
        nominalHz,
        incompleteRanges,
        ...data,
        periodDays: periodDays({
            fromDate: data.coverage.coveredFrom,
            toDate: data.coverage.coveredTo
        }),
        onlineCount: liveScopedDeviceCount(shellyIDs)
    };
}

async function assertNoScopedMeaningBoundary(
    orgId: string,
    internalIds: readonly number[],
    from: Date,
    to: Date
): Promise<void> {
    const [meters, meanings] = await Promise.all([
        listLogicalMeters(orgId, undefined, undefined, from),
        listLogicalMeterMeanings(orgId, from, to)
    ]);
    const boundary = scopedMeaningBoundary(
        meters,
        meanings,
        internalIds,
        from,
        to
    );
    if (!boundary) return;
    throw RpcError.Domain('ValidationFailed', {
        field: 'period',
        message:
            `Report range crosses logical-meter meaning revision ${boundary.revision} ` +
            `at ${boundary.effectiveFrom}; split the report at that UTC boundary`
    });
}

export function scopedMeaningBoundary(
    meters: readonly EnergyLogicalMeter[],
    meanings: readonly EnergyLogicalMeterMeaning[],
    internalIds: readonly number[],
    from: Date,
    to: Date
): EnergyLogicalMeterMeaning | null {
    const scope = new Set(internalIds);
    const relevantMeterIds = new Set(
        meters
            .filter((meter) =>
                meter.points.some((point) => scope.has(point.deviceId))
            )
            .map((meter) => meter.id)
    );
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return (
        meanings.find((meaning) => {
            if (
                !relevantMeterIds.has(meaning.meterId) ||
                !meaning.effectiveFrom
            ) {
                return false;
            }
            const at = new Date(meaning.effectiveFrom).getTime();
            return at > fromMs && at < toMs;
        }) ?? null
    );
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

function resolveReportQuantity(
    params: ReportGenerateEnergyParams,
    tariff: TariffSpec | null
): TariffQuantityMetric {
    const commodity =
        params.commodity ?? (tariff ? tariffCommodity(tariff) : 'electricity');
    const billedUnit =
        params.billedUnit ??
        (tariff ? tariffBilledUnit(tariff) : defaultBilledUnit(commodity));
    if (
        tariff &&
        (tariffCommodity(tariff) !== commodity ||
            tariffBilledUnit(tariff) !== billedUnit)
    ) {
        throw RpcError.InvalidParams(
            'Report commodity and billedUnit must match the selected tariff.'
        );
    }
    const metric = quantityMetric(commodity, billedUnit);
    if (!metric) {
        throw RpcError.InvalidParams(
            `Reports cannot bill ${commodity} in ${billedUnit}.`
        );
    }
    return metric;
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
async function resolvePeakSelection(
    request: ReadEnergySeriesRequest
): Promise<{internalIds: number[]; constrained: boolean}> {
    const wanted = await resolvePeakDeviceShellyIds(request.params);
    if (!wanted || wanted.length === 0) {
        return {internalIds: request.internalIds, constrained: false};
    }
    const want = new Set(wanted);
    return {
        internalIds: request.internalIds.filter((id) =>
            want.has(request.deviceMap.get(id) ?? '')
        ),
        constrained: true
    };
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
        }>('SELECT peak_device_ids FROM ui.fn_dashboard_settings_fetch($1)', [
            dashboardId
        ]);
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
        req.deviceMap,
        req.range.fromDate
    );
    if (!config) return null;
    try {
        const rows = await queryLogicalChannelEnergyTotals({
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
    deviceMap: Map<number, string>,
    asOf: Date
): Promise<PvConfig | null> {
    const roleRefs = await pvRefsFromRoles(orgId, deviceMap, asOf);
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
    deviceMap: Map<number, string>,
    asOf: Date
): Promise<PvRoleRefs | null> {
    try {
        const refs = pvRefsFromMeters(
            await listLogicalMeters(orgId, undefined, undefined, asOf),
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
            'SELECT pv_mode, pv_grid_refs, pv_generation_refs FROM ui.fn_dashboard_settings_fetch($1)',
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
    assertExclusiveEnergyReportScope(request.params);
    if (request.params.locationIds !== undefined) {
        return resolveLocationIdsForEnergyReport(
            request.params.locationIds,
            request.sender,
            orgId
        );
    }
    return resolveScopeOnlyForEnergyReport(
        request.params.scope,
        request.sender,
        orgId
    );
}

// A physical source stays in scope next to a custom device built from it: the
// energy reads leave out only the channels that custom device represents.
async function resolveDeviceMap(
    shellyIDs: readonly string[]
): Promise<{internalIds: number[]; deviceMap: Map<number, string>}> {
    const {internalIds, idMap} = await PostgresProvider.resolveDeviceIds([
        ...shellyIDs
    ]);
    if (!internalIds.length) throw RpcError.NotFound('device_ids');
    return {
        internalIds,
        deviceMap: new Map(
            Object.entries(idMap).map(([key, value]) => [+key, value])
        )
    };
}

export interface EnergyReportRange {
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
    currency: string;
    quantityMetric: TariffQuantityMetric;
    context?: ReportJobContext;
}

async function readStoredDemandSamples(
    request: ReadEnergySeriesRequest,
    repo: Awaited<ReturnType<typeof defaultEnergyRepository>>,
    meterIds: readonly number[]
): Promise<{
    master: TariffDemandSample[];
    devices: TariffDemandDeviceSample[];
}> {
    const demand = request.tariff?.demand;
    if (!demand || meterIds.length === 0) return {master: [], devices: []};
    // Per-phase tag first, meter total as fallback. Reading total_apparent_power
    // alone missed every monophase meter: it reports per channel and no total.
    const [phaseTag, totalTag] =
        demand.unit === 'kVA'
            ? ['apparent_power', 'total_apparent_power']
            : ['power', 'total_power'];
    // Read a safe superset of complete local billing periods. The calculator
    // assigns every bucket using the tariff timezone and billing-day anchor;
    // a UTC month subtraction would clip western/eastern boundary buckets.
    const localFrom = dateInZone(
        request.range.fromDate,
        request.tariff!.timezone
    );
    const currentAnchorMonth =
        localFrom.day < request.tariff!.billingDay ? -1 : 0;
    const historyMonth = shiftMonth(
        localFrom.year,
        localFrom.month,
        currentAnchorMonth - Math.max(0, demand.ratchetMonths - 1)
    );
    const historyFrom = localMidnightToUtc(
        {
            year: historyMonth.year,
            month: historyMonth.month,
            day: request.tariff!.billingDay
        },
        request.tariff!.timezone
    );
    const rows = await repo.queryDevicePowerAvg({
        // The same stored buckets provide both the master bill peak and each
        // tenant's contribution at that instant. One query avoids a second
        // pass over the long-term rollup.
        internalIds: request.internalIds,
        from: historyFrom,
        to: request.range.toDate,
        bucket: '15 minutes',
        phaseTag,
        totalTag
    });
    const byBucket = new Map<string, Map<number, number>>();
    for (const row of rows) {
        const value = Number(row.avg_w);
        if (!Number.isFinite(value)) continue;
        const key = new Date(row.bucket).toISOString();
        const devices = byBucket.get(key) ?? new Map<number, number>();
        devices.set(row.device, value);
        byBucket.set(key, devices);
    }
    const required = new Set(meterIds);
    const master = [...byBucket.entries()]
        .filter(([, devices]) =>
            [...required].every((device) => devices.has(device))
        )
        .map(([bucket, devices]) => ({
            at: new Date(bucket),
            value:
                [...required].reduce(
                    (sum, device) => sum + (devices.get(device) ?? 0),
                    0
                ) / 1_000,
            unit: demand.unit,
            intervalMinutes: 15 as const
        }));
    const devices = [...byBucket.entries()].flatMap(([bucket, byDevice]) =>
        [...byDevice.entries()].map(([deviceId, value]) => ({
            at: new Date(bucket),
            deviceId,
            value: value / 1_000,
            unit: demand.unit,
            intervalMinutes: 15 as const
        }))
    );
    return {master, devices};
}

async function readEnergySeries(request: ReadEnergySeriesRequest): Promise<{
    priorConsByDevice: Map<number, number>;
    priorTotalCons: number;
    timeSeries: BoundedTimeSeriesAggregation;
    phase: BoundedPhaseAggregation;
    frequency: FrequencyStats;
    measured: MeasuredMetrics;
    demandSamples: readonly TariffDemandSample[];
    demandDeviceSamples: readonly TariffDemandDeviceSample[];
    hourlyConsumedKWh: readonly number[];
    locationScope: ScopeData;
    groupScope: ScopeData;
    tagScope: ScopeData;
    feedInPricing: EnergyReportFeedInPricing | null;
    gasConversions: readonly GasConversionDisclosure[];
    coverage: QuantityCoverageInterval;
    cleanup(): Promise<void>;
}> {
    const bucket = reportBucket(request.params);
    const rate = rateContext(request.params, request.timezone);
    const cancelCheck = createReportCancelPoller(request.context);
    const repo = await defaultEnergyRepository();
    const electrical =
        request.quantityMetric.commodity === 'electricity' &&
        request.quantityMetric.billedUnit === 'kWh';
    const peakSelection = electrical
        ? await resolvePeakSelection(request)
        : {internalIds: [] as number[], constrained: false};
    const demandSeries = electrical
        ? await readStoredDemandSamples(
              request,
              repo,
              peakSelection.internalIds
          )
        : {master: [], devices: []};
    const rawMetric = rawQuantityMetric(request.quantityMetric);
    if (!rawMetric) {
        throw RpcError.Domain('ValidationFailed', {
            message: 'The report has no supported raw quantity for conversion.',
            field: 'billedUnit'
        });
    }
    const measuredRows = await repo.queryEnergy15minByChannel({
        internalIds: request.internalIds,
        from: request.range.fromDate,
        to: request.range.toDate,
        tags: [
            rawMetric.consumptionTag,
            ...(rawMetric.returnedTag ? [rawMetric.returnedTag] : [])
        ],
        commodity: rawMetric.commodity,
        electricalSource: request.params.electricalSource
    });
    // A live meter whose counter never moved reports a real zero, so the report
    // states it as measured rather than refusing the period as unrecorded.
    const pointRows = await meteredRowsOrZero(measuredRows, () =>
        readMeteredZeroRows({
            repo,
            internalIds: request.internalIds,
            from: request.range.fromDate,
            to: request.range.toDate,
            metric: rawMetric
        })
    );
    const coverage = await resolveQuantityCoverageInterval(
        pointRows,
        request.range.fromDate,
        request.range.toDate,
        rawMetric,
        {
            internalIds: request.internalIds,
            readJoinDates: (ids) => repo.resolveDeviceJoinDates(ids)
        },
        // A report over a partly recorded range has something true to show, and
        // says so in its own coverage section rather than refusing outright.
        {clampToRecorded: true}
    );
    const measuredRange = measuredEnergyRange(request.range, coverage);
    const measuredRequest = {...request, range: measuredRange};
    const gasConversion = request.quantityMetric.requiresConversion
        ? await prepareGasReportConversion({
              orgId: request.orgId,
              deviceMap: request.deviceMap,
              currentRawRows: pointRows,
              priorRawRows:
                  coverage.status === 'partial'
                      ? []
                      : await repo.queryEnergy15minByChannel({
                            internalIds: request.internalIds,
                            from: request.range.priorFrom,
                            to: request.range.priorTo,
                            tags: [rawMetric.consumptionTag],
                            commodity: 'gas',
                            electricalSource: request.params.electricalSource
                        }),
              rawMetric,
              targetMetric: request.quantityMetric,
              granularity: request.params.granularity ?? 'day',
              repo: await defaultGasConversionRepository()
          })
        : null;
    const costRows = gasConversion
        ? gasConversion.currentRows
        : buildEnergyCostRows(pointRows, rawMetric);
    const costResolver = await timeVaryingCostResolver(
        measuredRequest,
        rate,
        repo,
        pointRows,
        costRows,
        rawMetric
    );
    const feedInPricing =
        electrical || request.quantityMetric.commodity === 'gas'
            ? await readEnergyReportFeedInPricing({
                  orgId: request.orgId,
                  repo,
                  internalIds: request.internalIds,
                  deviceMap: request.deviceMap,
                  from: measuredRange.fromDate,
                  to: measuredRange.toDate,
                  quantityMetric: request.quantityMetric,
                  electricalSource: request.params.electricalSource,
                  importCurrency: request.currency,
                  sourceRows: pointRows,
                  preparedRows: gasConversion?.currentRows
              })
            : null;
    const [
        bounded,
        priorConsByDevice,
        hourlyProfile,
        locationScope,
        groupScope,
        tagScope
    ] = await Promise.all([
        buildBoundedEnergySeries({
            internalIds: request.internalIds,
            from: measuredRange.fromDate,
            to: measuredRange.toDate,
            bucket,
            granularity: request.params.granularity ?? 'day',
            timezone: request.timezone,
            deviceMap: request.deviceMap,
            rate,
            costResolver,
            peakInternalIds: peakSelection.internalIds,
            quantityMetric: request.quantityMetric,
            quantityConversion: gasConversion ?? undefined,
            electricalSource: request.params.electricalSource,
            // Cancel is honoured inside the read, not only around it.
            onChunk: request.context
                ? () => cancelCheck.throwIfCancelled()
                : undefined
        }),
        coverage.status === 'partial'
            ? Promise.resolve(new Map<number, number>())
            : gasConversion
              ? Promise.resolve(gasConversion.priorByDevice)
              : fetchPriorConsumptionByDevice({
                    internalIds: request.internalIds,
                    priorFrom: request.range.priorFrom,
                    priorTo: request.range.priorTo,
                    quantityMetric: request.quantityMetric,
                    electricalSource: request.params.electricalSource
                }),
        electrical
            ? fetchHourlyProfile({
                  deviceIds: request.internalIds,
                  from: measuredRange.fromDate,
                  to: measuredRange.toDate,
                  timezone: request.timezone ?? undefined
              })
            : Promise.resolve({consumedKWh: []}),
        fetchLocationScope(request.orgId, [...request.deviceMap.values()]),
        fetchGroupScope(request.orgId, [...request.deviceMap.values()]),
        fetchTagScope(request.orgId, [...request.deviceMap.values()])
    ]);
    const timeSeries = bounded.timeSeries;
    // Billed demand: the highest 15-minute average, at 15-minute grain rather
    // than smoothed over the display bucket. Never the display-bucket mean.
    if (typeof timeSeries.truePeakPower === 'number') {
        timeSeries.peakPower = +timeSeries.truePeakPower.toFixed(1);
    } else if (peakSelection.constrained) timeSeries.peakPower = 0;
    return {
        priorConsByDevice,
        priorTotalCons: totalPriorConsumption(priorConsByDevice),
        timeSeries,
        phase: bounded.phase,
        frequency: timeSeries.frequency,
        measured: timeSeries.measured,
        demandSamples: demandSeries.master,
        demandDeviceSamples: demandSeries.devices,
        hourlyConsumedKWh: hourlyProfile.consumedKWh,
        locationScope,
        groupScope,
        tagScope,
        feedInPricing,
        gasConversions: gasConversion?.disclosures ?? [],
        coverage,
        cleanup: bounded.cleanup
    };
}

function measuredEnergyRange(
    requested: EnergyReportRange,
    coverage: QuantityCoverageInterval
): EnergyReportRange {
    if (coverage.status === 'complete') return requested;
    const {priorFrom, priorTo} = inferPriorWindow({
        from: coverage.coveredFrom,
        to: coverage.coveredTo
    });
    return {
        fromDate: coverage.coveredFrom,
        toDate: coverage.coveredTo,
        priorFrom,
        priorTo
    };
}

// Cost pass over 15-min pieces — for time-varying tariffs or a stored tariff.
// A flat inline rate is already correct per display bucket, so it is skipped.
async function timeVaryingCostResolver(
    request: ReadEnergySeriesRequest,
    rate: RateContext,
    repo: Awaited<ReturnType<typeof defaultEnergyRepository>>,
    pointRows: Awaited<
        ReturnType<
            Awaited<
                ReturnType<typeof defaultEnergyRepository>
            >['queryEnergy15minByChannel']
        >
    >,
    costRows: ReturnType<typeof buildEnergyCostRows>,
    rawMetric: TariffQuantityMetric
): Promise<CostPriceResolver | null> {
    const points = [
        ...new Map(
            pointRows.map((row) => {
                const deviceExternalId =
                    request.deviceMap.get(row.device) ?? '';
                const point = {
                    deviceExternalId,
                    channel: row.channel,
                    commodity: request.quantityMetric.commodity
                };
                return [`${deviceExternalId}|${row.channel}`, point];
            })
        ).values()
    ].filter((point) => point.deviceExternalId !== '');
    // Canonical physical hierarchy is resolved in SQL for each actual point.
    const resolverOverride = await buildPerPointResolver({
        orgId: request.orgId,
        deviceMap: request.deviceMap,
        defaultTariff: request.tariff,
        from: request.range.fromDate,
        to: request.range.toDate,
        rate,
        points,
        rows: costRows,
        quantityMetric: request.quantityMetric,
        loadHistory: async (from, to) => {
            if (request.quantityMetric.requiresConversion) {
                throw RpcError.Domain('ValidationFailed', {
                    message:
                        'Stepped gas tariffs require converted pre-period history and are not supported.',
                    field: 'tariff.kind'
                });
            }
            return buildEnergyCostRows(
                await repo.queryEnergy15minByChannel({
                    internalIds: request.internalIds,
                    from,
                    to,
                    tags: [rawMetric.consumptionTag],
                    commodity: rawMetric.commodity,
                    electricalSource: request.params.electricalSource
                }),
                rawMetric
            );
        }
    });
    // Flat inline rate with no tariff and no assignments is already correct.
    if (rate.tariffMode === 'single' && !request.tariff && !resolverOverride) {
        return null;
    }
    return buildCostPriceResolver({
        repo,
        internalIds: request.internalIds,
        from: request.range.fromDate,
        to: request.range.toDate,
        granularity: request.params.granularity ?? 'day',
        rate,
        tariff: request.tariff,
        resolverOverride,
        quantityMetric: request.quantityMetric
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
