import {createHash} from 'node:crypto';

import {
    defaultEnergyRepository,
    type EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import {listLogicalMeters} from '../../modules/repositories/LogicalMeterRepository';
import {defaultTariffRepository} from '../../modules/repositories/TariffRepository';
import RpcError from '../../rpc/RpcError';
import {parseDateRange} from '../../rpc/validation';
import {roundCurrencyAmount} from '../../types/api/_currency';
import type {
    BillQuoteAppliedTariff,
    BillQuoteAvoidedImportCost,
    BillQuoteBand,
    BillQuoteDemand,
    BillQuoteParams,
    BillQuoteResponse,
    BillQuoteUsageBucket,
    BillQuoteWarning
} from '../../types/api/bill';
import {BILL_QUOTE_MAX_SERIES_BUCKETS} from '../../types/api/bill';
import type {
    EnergyLogicalMeter,
    EnergyQueryParams
} from '../../types/api/energy';
import type {TariffSpec} from '../../types/api/tariff';
import {resolveScope, type SenderCapabilities} from '../energy/queryHandler';
import {
    calculateEnergyQueryPricing,
    type EnergyPricingPoint,
    type EnergyQueryPricingAvoidedImportCost,
    type EnergyQueryPricingBandUsage,
    type EnergyQueryPricingBucketUsage,
    type EnergyQueryPricingDeps,
    type EnergyQueryPricingDeviceUsage
} from '../energy/queryPricing';
import {seriesBucketCount} from '../energy/seriesBuckets';
import {calculateBillChargeSummary} from '../report/energyReportBillCharges';
import {publicIncompleteRanges} from '../report/energyReportCompleteness';
import type {QuantityCoverageInterval} from '../report/energyReportCost';
import {dateInZone} from '../report/localTimeInZone';
import {pvRefsFromMeters} from '../report/pvFromRoles';
import {localMidnightToUtc, shiftMonth} from '../report/reportPeriod';
import type {
    TariffDemandChargeResult,
    TariffDemandSample
} from '../report/tariffDemandCharges';
import {
    defaultBilledUnit,
    quantityMetric,
    tagsForQuantityMetric
} from '../report/tariffQuantity';
import {
    calculateTariffTaxes,
    effectiveTariffTaxes
} from '../report/tariffTaxes';
import {readMeteredZeroRows} from './meteredZero';
import {
    type MeterBillingScope,
    meterOwnsEveryMeasuredChannel,
    resolveMeterBillingScope
} from './meterScope';

interface QuoteTariffReader {
    get(org: string, id: number): Promise<TariffSpec | null>;
}

const MAX_QUOTE_RANGE_MS = 10 * 366 * 24 * 60 * 60 * 1000;
const MAX_QUOTE_POINT_INTERVALS = 5_000_000;

export interface BillingQuoteDeps {
    energyRepo?: EnergyRepository;
    tariffRepo?: QuoteTariffReader;
    pricingDeps?: EnergyQueryPricingDeps;
    calculatePricing?: typeof calculateEnergyQueryPricing;
    /** Logical-meter roles are Fleet's source of truth for which points meter
     * on-site generation; only the PV counterfactual reads them. */
    listLogicalMeters?: (
        orgId: string,
        asOf: Date
    ) => Promise<EnergyLogicalMeter[]>;
}

/**
 * Calculate a utility bill from Fleet measurements and stored tariff
 * assignments. This is deliberately stricter than a chart cost: it refuses to
 * invent a complete bill when the selected scope does not identify one
 * coherent billing service point or when any charge determinant is missing.
 */
export async function calculateBillingQuote(
    params: BillQuoteParams,
    sender: SenderCapabilities,
    deps: BillingQuoteDeps = {}
): Promise<BillQuoteResponse> {
    const {from, to} = validateQuoteRequest(params);
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    const repo = deps.energyRepo ?? (await defaultEnergyRepository());
    const meterScope = params.meterIds
        ? await readMeterScope(deps, {orgId, params, from, repo, sender})
        : null;
    const selectedDevices = devicesForSelector(params);
    const scope =
        meterScope ??
        (await resolveScope(
            sender,
            {
                ...(params.scope ? {scope: params.scope} : {}),
                ...(selectedDevices ? {devices: selectedDevices} : {})
            },
            repo
        ));
    const channelKeys =
        meterScope?.channelKeys ??
        validateAndResolveChannels(params, scope.idMap);
    assertQuoteWorkload(from, to, scope.internalIds.length, channelKeys?.size);
    assertQuoteSeriesWorkload(from, to, params.seriesBucket);
    const generationPoints = params.avoidedImportCost
        ? await resolveGenerationPoints(deps, orgId, scope.idMap, from)
        : [];
    const rawMetric = quantityMetric(
        params.commodity,
        params.commodity === 'gas' && params.billedUnit !== 'm3'
            ? 'm3'
            : (params.billedUnit ?? defaultBilledUnit(params.commodity))
    );
    if (!rawMetric) {
        throw RpcError.InvalidParams(
            `Unsupported ${params.commodity}/${params.billedUnit ?? defaultBilledUnit(params.commodity)} billing quantity.`
        );
    }
    const energyParams: EnergyQueryParams = {
        from: from.toISOString(),
        to: to.toISOString(),
        tags: tagsForQuantityMetric(rawMetric) as EnergyQueryParams['tags'],
        commodity: params.commodity,
        ...(params.commodity === 'electricity'
            ? {electricalSource: 'ac_mains' as const}
            : {}),
        pricing: {}
    };
    const calculatePricing =
        deps.calculatePricing ?? calculateEnergyQueryPricing;
    let deviceBreakdown: readonly EnergyQueryPricingDeviceUsage[] = [];
    let usageSeries: readonly EnergyQueryPricingBucketUsage[] = [];
    let bandUsage: readonly EnergyQueryPricingBandUsage[] = [];
    let avoidedImportCost: EnergyQueryPricingAvoidedImportCost | null = null;
    let quantityCoverage: QuantityCoverageInterval = {
        status: 'complete',
        requestedFrom: from,
        requestedTo: to,
        coveredFrom: from,
        coveredTo: to,
        fraction: 1
    };
    const callerCapture = deps.pricingDeps?.captureDeviceUsage;
    const callerBucketCapture = deps.pricingDeps?.captureBucketUsage;
    const callerBandCapture = deps.pricingDeps?.captureBandUsage;
    const callerAvoidedCapture = deps.pricingDeps?.captureAvoidedImportCost;
    const callerCoverageCapture = deps.pricingDeps?.captureQuantityCoverage;
    let meteredZero = false;
    const pricing = await calculatePricing(energyParams, sender, repo, scope, {
        ...deps.pricingDeps,
        allowLongRange: true,
        allowPartialQuantityCoverage: true,
        clampPartialQuantityCoverage: true,
        readMeteredZeroRows: async (metric) => {
            const rows = await readMeteredZeroRows({
                repo,
                internalIds: scope.internalIds,
                from,
                to,
                metric
            });
            meteredZero = rows.length > 0;
            return rows;
        },
        captureQuantityCoverage: (coverage) => {
            quantityCoverage = coverage;
            callerCoverageCapture?.(coverage);
        },
        captureDeviceUsage: (items) => {
            deviceBreakdown = items;
            callerCapture?.(items);
        },
        captureBandUsage: (items) => {
            bandUsage = items;
            callerBandCapture?.(items);
        },
        ...(params.seriesBucket
            ? {
                  seriesBucket: params.seriesBucket,
                  captureBucketUsage: (items) => {
                      usageSeries = items;
                      callerBucketCapture?.(items);
                  }
              }
            : {}),
        ...(params.avoidedImportCost
            ? {
                  generationPoints,
                  captureAvoidedImportCost: (result) => {
                      avoidedImportCost = result;
                      callerAvoidedCapture?.(result);
                  }
              }
            : {}),
        ...(channelKeys
            ? {
                  includePoint: (device: string, channel: number) =>
                      channelKeys.has(`${device}|${channel}`)
              }
            : {})
    });
    if (params.billedUnit && pricing.billedUnit !== params.billedUnit) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Resolved tariffs bill in ${pricing.billedUnit}, not requested unit ${params.billedUnit}.`,
            field: 'billedUnit'
        });
    }

    const warnings: BillQuoteWarning[] = [];
    const missing = new Set<string>();
    if (quantityCoverage.status === 'partial') {
        warnings.push({
            code: 'partial_data_coverage',
            message:
                `Recorded quantity covers ${quantityCoverage.coveredFrom.toISOString()} ` +
                `through ${quantityCoverage.coveredTo.toISOString()} of the requested ` +
                `${quantityCoverage.requestedFrom.toISOString()} through ` +
                `${quantityCoverage.requestedTo.toISOString()} period. This quote ` +
                'prices the covered interval; the rest is excluded, not treated ' +
                'as zero.'
        });
    }
    const incompleteRanges = publicIncompleteRanges(
        await repo.queryEmIncompleteRanges(scope.internalIds, from, to),
        scope.idMap,
        channelKeys
            ? (device, channel) => channelKeys.has(`${device}|${channel}`)
            : undefined
    );
    if (incompleteRanges.length > 0) {
        addWarning(
            warnings,
            missing,
            'em_history_incomplete',
            `Meter history is incomplete in ${incompleteRanges.length} range(s) of this period, listed in incompleteRanges. The quote does not treat them as zero consumption.`
        );
    }
    // Not a missing determinant: the quantity is measured, so it never blocks a
    // complete bill. It is reported so a zero line is read as proof, not a gap.
    if (meteredZero) {
        warnings.push({
            code: 'measured_zero_consumption',
            message:
                'The meter reported throughout this period and its energy counter did not advance, so the billed quantity is a measured zero rather than missing data.'
        });
    }
    if (pricing.status === 'unconfigured') {
        addWarning(
            warnings,
            missing,
            'tariff_not_configured',
            'No tariff assignment covers the measured quantity.'
        );
    } else if (pricing.status === 'partial') {
        addWarning(
            warnings,
            missing,
            'partially_priced',
            'Some measured quantity is not covered by a tariff assignment.'
        );
    }
    const tariffRepo = deps.tariffRepo ?? (await defaultTariffRepository());
    const importTariffs = await loadAppliedTariffs(
        tariffRepo,
        orgId,
        pricing.tariffIds
    );
    const exportTariffs = await loadAppliedTariffs(
        tariffRepo,
        orgId,
        pricing.exportTariffIds
    );
    const tariff = importTariffs.length === 1 ? importTariffs[0].spec : null;
    const multipleTariffsNeedContractScope =
        importTariffs.length > 1 &&
        importTariffs.some((item) => requiresSingleTariff(item.spec));
    if (multipleTariffsNeedContractScope) {
        addWarning(
            warnings,
            missing,
            'multiple_import_tariffs',
            "The scope resolves to multiple import tariffs with fixed, demand, component, or tax rules. Usage is priced, but Fleet will not apply one tariff's contract charges to the whole scope."
        );
    }
    // One logical meter is one utility connection: the network bills the
    // connection, so its contract charges apply to the meters together.
    const oneConnection = meterScope !== null && params.meterIds?.length === 1;
    const coherentServicePoint =
        oneConnection ||
        scope.internalIds.length === 1 ||
        channelKeys?.size === 1;
    if (tariff && requiresSingleServicePoint(tariff) && !coherentServicePoint) {
        addWarning(
            warnings,
            missing,
            'billing_service_point_ambiguous',
            'This scope contains multiple meters but the tariff has fixed, demand, or component rules. Request one billing service point or use separate quotes.'
        );
    }

    const canCalculateBill =
        quantityCoverage.status === 'complete' &&
        pricing.status === 'priced' &&
        tariff !== null &&
        pricing.tariffIds.length === 1 &&
        (!requiresSingleServicePoint(tariff) || coherentServicePoint);
    const periodDays = Math.max(
        0,
        (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
    );
    const usageCharge = pricing.energyCost;
    const usageOnlyComplete =
        quantityCoverage.status === 'complete' &&
        pricing.status === 'priced' &&
        importTariffs.length > 1 &&
        !multipleTariffsNeedContractScope &&
        usageCharge !== null;
    let summary: ReturnType<typeof calculateBillChargeSummary> = null;
    if (canCalculateBill && usageCharge !== null) {
        const demandSamples = tariff.demand
            ? await readDemandSamples(repo, scope.internalIds, from, to, tariff)
            : [];
        const peakPowerW =
            tariff.demandRate && !tariff.demand
                ? await repo.queryPeakPowerW({
                      internalIds: scope.internalIds,
                      from,
                      to
                  })
                : 0;
        const demandNeeded = Boolean(tariff.demand || tariff.demandRate);
        const wholeDeviceDemand =
            !demandNeeded ||
            (meterScope
                ? await meterCoversWholeDevices({
                      repo,
                      meterScope,
                      tags: energyParams.tags ?? [],
                      from,
                      to
                  })
                : channelKeys === null);
        if (!wholeDeviceDemand) {
            addWarning(
                warnings,
                missing,
                'channel_demand_unavailable',
                'Demand charges require a scoped billing-demand determinant; Fleet will not substitute a whole-device peak for selected channels.'
            );
        } else {
            summary = calculateBillChargeSummary({
                rows: [],
                tariff,
                peakPowerW: peakPowerW ?? 0,
                periodDays,
                fromDate: from,
                toDate: to,
                energyCost: usageCharge,
                consumptionUnits: pricing.consumptionQuantity,
                currencySymbol: '',
                demandSamples
            });
            if (summary?.demandResult?.complete === false) {
                addWarning(
                    warnings,
                    missing,
                    'demand_history_incomplete',
                    summary.demandResult.reason ??
                        'Demand history does not cover every required billing interval.'
                );
            }
        }
    }

    const returnedNeedsTariff = pricing.returnedQuantity > 1e-12;
    if (returnedNeedsTariff && pricing.exportCredit === null) {
        addWarning(
            warnings,
            missing,
            'export_tariff_not_configured',
            'Returned energy is present but is not fully covered by an export tariff.'
        );
    }
    const taxResult =
        summary && tariff
            ? calculateTariffTaxes(
                  summary.taxes,
                  {
                      energy: usageCharge ?? 0,
                      demand: summary.demand,
                      standing: summary.standing
                  },
                  summary.fractionDigits
              )
            : null;
    const coveredNetCost =
        pricing.status !== 'unconfigured' &&
        pricing.currency !== null &&
        (!returnedNeedsTariff || pricing.exportCredit !== null)
            ? roundCurrencyAmount(
                  pricing.coveredEnergyCost - (pricing.exportCredit ?? 0),
                  pricing.currency
              )
            : null;
    const billTotal =
        summary?.total ?? (usageOnlyComplete ? usageCharge : null);
    const complete =
        (summary?.complete === true || usageOnlyComplete) &&
        billTotal !== null &&
        (!returnedNeedsTariff || pricing.exportCredit !== null) &&
        missing.size === 0;
    const netCost =
        complete && billTotal !== null
            ? roundCurrencyAmount(
                  billTotal - (pricing.exportCredit ?? 0),
                  pricing.currency
              )
            : null;

    return {
        status:
            pricing.status === 'unconfigured'
                ? 'unconfigured'
                : complete
                  ? 'priced'
                  : 'partial',
        complete,
        from: from.toISOString(),
        to: to.toISOString(),
        currency: pricing.currency,
        billedUnit: pricing.billedUnit,
        quantity: pricing.consumptionQuantity,
        pricedQuantity: pricing.coveredConsumptionQuantity,
        unpricedQuantity: pricing.unpricedConsumptionQuantity,
        returnedQuantity: pricing.returnedQuantity,
        usageCharge,
        coveredUsageCharge: pricing.coveredEnergyCost,
        coveredNetCost,
        coveredNetCostBasis: 'priced_measured_usage_only',
        dataCoverage: {
            basis: 'recorded_quantity_interval',
            status: quantityCoverage.status,
            requestedFrom: quantityCoverage.requestedFrom.toISOString(),
            requestedTo: quantityCoverage.requestedTo.toISOString(),
            coveredFrom: quantityCoverage.coveredFrom.toISOString(),
            coveredTo: quantityCoverage.coveredTo.toISOString(),
            fraction: quantityCoverage.fraction
        },
        incompleteRanges,
        standingCharge: summary?.standing ?? (usageOnlyComplete ? 0 : null),
        demandCharge: summary?.demand ?? (usageOnlyComplete ? 0 : null),
        demand: publicDemand(summary?.demandResult ?? null),
        bands: bandUsage.length > 0 ? bandUsage.map(publicBand) : null,
        bandBasis: bandUsage.length > 0 ? bandBasisOf(tariff) : null,
        components:
            summary?.components.lines.map((line) => ({
                code: line.code,
                name: line.name,
                chargeClass: line.chargeClass,
                amount: line.amount,
                taxable: line.taxable
            })) ?? [],
        taxes: taxResult?.items ?? [],
        exportCredit: pricing.exportCredit,
        netCost,
        tariffIds: pricing.tariffIds,
        exportTariffIds: pricing.exportTariffIds,
        appliedTariffs: importTariffs.map((item) => item.public),
        appliedExportTariffs: exportTariffs.map((item) => item.public),
        tariffSnapshotHash: tariff ? snapshotHash(tariff) : null,
        assignmentSources: pricing.assignmentSources,
        exportAssignmentSources: pricing.exportAssignmentSources,
        deviceBreakdownBasis: 'measured_usage_only',
        deviceBreakdown: [...deviceBreakdown],
        // Both blocks are opt-in: a quote without the new params is the
        // response it has always been, byte for byte.
        ...(params.seriesBucket
            ? {
                  seriesBucket: params.seriesBucket,
                  seriesBasis: 'measured_usage_only' as const,
                  series: usageSeries.map(
                      (bucket): BillQuoteUsageBucket => ({...bucket})
                  )
              }
            : {}),
        ...(params.avoidedImportCost
            ? {avoidedImportCost: publicAvoidedImportCost(avoidedImportCost)}
            : {}),
        ...(pricing.gasConversions
            ? {gasConversions: pricing.gasConversions}
            : {}),
        warnings,
        missingConfigurationReasons: [...missing]
    };
}

async function loadAppliedTariffs(
    repo: QuoteTariffReader,
    orgId: string,
    ids: readonly number[]
): Promise<Array<{spec: TariffSpec; public: BillQuoteAppliedTariff}>> {
    return Promise.all(
        ids.map(async (id) => {
            const spec = await repo.get(orgId, id);
            if (!spec) throw RpcError.NotFound('tariff', String(id));
            return {
                spec,
                public: {
                    id,
                    name: spec.name,
                    effectiveFrom: spec.effectiveFrom ?? null,
                    effectiveTo: spec.effectiveTo ?? null,
                    sourceReference: spec.sourceReference ?? null,
                    snapshotHash: snapshotHash(spec)
                }
            };
        })
    );
}

function validateQuoteRequest(params: BillQuoteParams): {
    from: Date;
    to: Date;
} {
    if (params.scope && params.devices) {
        throw RpcError.InvalidParams(
            'scope and devices are mutually exclusive'
        );
    }
    // A meter selection carries its own devices and channels, so accepting a
    // second selector would leave two answers to what is being billed.
    if (
        params.meterIds &&
        (params.scope || params.devices || params.channels)
    ) {
        throw RpcError.InvalidParams(
            'meterIds is mutually exclusive with scope, devices and channels'
        );
    }
    const range = parseDateRange(params.from, params.to, MAX_QUOTE_RANGE_MS);
    if (params.channels && params.channels.length === 0) {
        throw RpcError.InvalidParams('channels must not be empty');
    }
    return range;
}

function assertQuoteWorkload(
    from: Date,
    to: Date,
    deviceCount: number,
    selectedChannelCount?: number
): void {
    const intervalCount = Math.ceil(
        (to.getTime() - from.getTime()) / (15 * 60 * 1000)
    );
    // Without an explicit channel selector, reserve three metering points per
    // device. This is intentionally conservative: a synchronous quote must
    // not monopolize the shared worker. The async report job owns larger work.
    const pointCount = Math.max(
        1,
        selectedChannelCount ?? Math.max(1, deviceCount) * 3
    );
    if (intervalCount * pointCount > MAX_QUOTE_POINT_INTERVALS) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                'This synchronous quote is too large for the selected scope and period. Narrow the scope or use an asynchronous utility report.',
            field: 'range'
        });
    }
}

/**
 * A series is response size, not read work, so it needs its own ceiling: the
 * existing point-interval guard would happily wave through 350k daily-priced
 * 15-minute bars. Reject an over-fine request outright rather than truncating
 * a chart into something that silently means less than it says.
 */
function assertQuoteSeriesWorkload(
    from: Date,
    to: Date,
    seriesBucket: BillQuoteParams['seriesBucket']
): void {
    if (!seriesBucket) return;
    const buckets = seriesBucketCount(from, to, seriesBucket);
    if (buckets > BILL_QUOTE_MAX_SERIES_BUCKETS) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `A '${seriesBucket}' series over this period needs ${buckets} buckets, ` +
                `over the ${BILL_QUOTE_MAX_SERIES_BUCKETS} a synchronous quote returns. ` +
                'Choose a coarser bucket or a shorter period.',
            field: 'seriesBucket'
        });
    }
}

/**
 * Metering points Fleet itself identifies as on-site generation: the points of
 * logical meters whose role is a generation role. Restricted to the scope the
 * caller is already authorized for, so this reads nothing new.
 */
async function resolveGenerationPoints(
    deps: BillingQuoteDeps,
    orgId: string,
    idMap: Readonly<Record<number, string>>,
    asOf: Date
): Promise<EnergyPricingPoint[]> {
    const read = deps.listLogicalMeters ?? defaultLogicalMeterReader;
    const deviceMap = new Map<number, string>(
        Object.entries(idMap).map(([id, external]) => [Number(id), external])
    );
    const refs = pvRefsFromMeters(await read(orgId, asOf), deviceMap);
    return refs.generationRefs
        .filter(
            (ref): ref is {device: string; channel: number} =>
                ref.channel !== null
        )
        .map((ref) => ({device: ref.device, channel: ref.channel}));
}

/** The billing scope of the logical meters the caller named. */
async function readMeterScope(
    deps: BillingQuoteDeps,
    input: {
        orgId: string;
        params: BillQuoteParams;
        from: Date;
        repo: EnergyRepository;
        sender: SenderCapabilities;
    }
): Promise<MeterBillingScope> {
    const read = deps.listLogicalMeters ?? defaultLogicalMeterReader;
    return resolveMeterBillingScope({
        meterIds: input.params.meterIds ?? [],
        meters: await read(input.orgId, input.from),
        commodity: input.params.commodity,
        repo: input.repo,
        sender: input.sender
    });
}

/** Whether whole-device power is a safe demand determinant for this
 * connection — see `meterOwnsEveryMeasuredChannel`. */
async function meterCoversWholeDevices(input: {
    repo: EnergyRepository;
    meterScope: MeterBillingScope;
    tags: readonly string[];
    from: Date;
    to: Date;
}): Promise<boolean> {
    const measured = await input.repo.queryChannelEnergyTotals({
        internalIds: input.meterScope.internalIds,
        from: input.from,
        to: input.to,
        tags: input.tags
    });
    return meterOwnsEveryMeasuredChannel({
        channelKeys: input.meterScope.channelKeys,
        idMap: input.meterScope.idMap,
        measured
    });
}

function defaultLogicalMeterReader(
    orgId: string,
    asOf: Date
): Promise<EnergyLogicalMeter[]> {
    return listLogicalMeters(orgId, undefined, undefined, asOf);
}

/** Nothing captured means the pricing engine never got far enough to judge —
 * report that as unavailable, never as a confident zero saving. */
function publicAvoidedImportCost(
    captured: EnergyQueryPricingAvoidedImportCost | null
): BillQuoteAvoidedImportCost {
    const base = captured ?? {
        status: 'unavailable' as const,
        currency: null,
        billedUnit: '',
        generationQuantity: null,
        exportedQuantity: null,
        selfConsumedQuantity: null,
        avoidedCost: null,
        tariffIds: [],
        warnings: [
            {
                code: 'counterfactual_not_evaluated',
                message:
                    'Fleet did not evaluate self-consumption for this quote.'
            }
        ],
        missingConfigurationReasons: ['counterfactual_not_evaluated']
    };
    return {
        basis: 'counterfactual_estimate',
        method: 'measured_generation_minus_export',
        ...base
    };
}

/** The determinant behind the scalar, in wire shape. Null when the tariff has
 * no structured demand contract — never an empty object that reads as "we
 * measured demand and found none". */
function publicDemand(
    result: TariffDemandChargeResult | null
): BillQuoteDemand | null {
    if (!result) return null;
    return {
        unit: result.unit,
        apparentPowerMethod: result.apparentPowerMethod,
        intervalMinutes: result.intervalMinutes,
        chargePeriod: result.chargePeriod,
        complete: result.complete,
        reason: result.reason,
        periods: result.periods.map((period) => ({
            periodKey: period.periodKey,
            periodStart: period.periodStart.toISOString(),
            periodEnd: period.periodEnd.toISOString(),
            billingDays: period.billingDays,
            measuredPeak: period.measuredPeak,
            billedPeak: period.billedPeak,
            peakAt: period.peakAt?.toISOString() ?? null,
            ratchetApplied: period.ratchetApplied,
            charge: period.charge
        }))
    };
}

/**
 * Declared only when the tariff names every one of its windows. A tariff that
 * names some leaves the rest to the price rank, and the caller is told the
 * weaker of the two rather than a basis that is only partly true.
 */
function bandBasisOf(tariff: TariffSpec | null): 'declared' | 'price_rank' {
    const windows = (tariff?.seasons ?? []).flatMap((season) => season.windows);
    return windows.length > 0 && windows.every((window) => window.band)
        ? 'declared'
        : 'price_rank';
}

function publicBand(band: EnergyQueryPricingBandUsage): BillQuoteBand {
    return {
        band: band.band,
        quantity: band.quantity,
        usageCharge: band.usageCharge,
        averagePrice: band.averagePrice
    };
}

function devicesForSelector(params: BillQuoteParams): string[] | undefined {
    if (params.scope) return undefined;
    if (params.devices) return params.devices;
    if (!params.channels) return undefined;
    return [...new Set(params.channels.map((point) => point.device))];
}

function validateAndResolveChannels(
    params: BillQuoteParams,
    idMap: Readonly<Record<number, string>>
): Set<string> | null {
    if (!params.channels) return null;
    const inScope = new Set(Object.values(idMap));
    const keys = new Set<string>();
    for (const point of params.channels) {
        if (!inScope.has(point.device)) {
            throw RpcError.Domain('PermissionDenied');
        }
        const key = `${point.device}|${point.channel}`;
        if (keys.has(key)) {
            throw RpcError.InvalidParams(`Duplicate channel ${key}`);
        }
        keys.add(key);
    }
    return keys;
}

function requiresSingleTariff(tariff: TariffSpec): boolean {
    return Boolean(
        requiresSingleServicePoint(tariff) ||
            effectiveTariffTaxes(tariff).length
    );
}

function requiresSingleServicePoint(tariff: TariffSpec): boolean {
    return Boolean(
        tariff.standingCharge ||
            tariff.demandRate ||
            tariff.demand ||
            tariff.components?.length
    );
}

async function readDemandSamples(
    repo: EnergyRepository,
    internalIds: readonly number[],
    from: Date,
    to: Date,
    tariff: TariffSpec
): Promise<TariffDemandSample[]> {
    if (!tariff.demand || internalIds.length === 0) return [];
    const [phaseTag, totalTag] =
        tariff.demand.unit === 'kVA'
            ? ['apparent_power', 'total_apparent_power']
            : ['power', 'total_power'];
    // Demand ratchets reach into earlier complete local billing periods. Load
    // the same tariff-timezone history window as the report engine so a quote
    // cannot understate a ratcheted peak at the start of the selected range.
    const localFrom = dateInZone(from, tariff.timezone);
    const currentAnchorMonth = localFrom.day < tariff.billingDay ? -1 : 0;
    const historyMonth = shiftMonth(
        localFrom.year,
        localFrom.month,
        currentAnchorMonth - Math.max(0, tariff.demand.ratchetMonths - 1)
    );
    const historyFrom = localMidnightToUtc(
        {
            year: historyMonth.year,
            month: historyMonth.month,
            day: tariff.billingDay
        },
        tariff.timezone
    );
    const rows = await repo.queryDevicePowerAvg({
        internalIds,
        from: historyFrom,
        to,
        bucket: '15 minutes',
        phaseTag,
        totalTag
    });
    const required = new Set(internalIds);
    const byBucket = new Map<string, Map<number, number>>();
    for (const row of rows) {
        const value = Number(row.avg_w);
        if (!Number.isFinite(value)) continue;
        const key = new Date(row.bucket).toISOString();
        const devices = byBucket.get(key) ?? new Map<number, number>();
        devices.set(row.device, value);
        byBucket.set(key, devices);
    }
    return [...byBucket.entries()]
        .filter(([, devices]) =>
            [...required].every((device) => devices.has(device))
        )
        .map(([at, devices]) => ({
            at: new Date(at),
            value:
                [...required].reduce(
                    (sum, device) => sum + (devices.get(device) ?? 0),
                    0
                ) / 1000,
            unit: tariff.demand!.unit,
            intervalMinutes: 15
        }));
}

function addWarning(
    warnings: BillQuoteWarning[],
    missing: Set<string>,
    code: string,
    message: string
): void {
    warnings.push({code, message});
    missing.add(code);
}

function snapshotHash(tariff: TariffSpec): string {
    return createHash('sha256')
        .update(JSON.stringify(sortJson(tariff)))
        .digest('hex');
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, sortJson(item)])
    );
}
