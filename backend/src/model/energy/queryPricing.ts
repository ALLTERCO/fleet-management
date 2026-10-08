// Authoritative Energy.Query pricing. It reuses the report tariff-selection,
// live-price and 15-minute cost engines; this module only adds API coverage
// semantics (priced / partial / unconfigured) and read authorization.

import type {
    Energy15minByChannelRow,
    EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import {
    defaultGasConversionRepository,
    type GasConversionRepository
} from '../../modules/repositories/GasConversionRepository';
import {defaultTariffRepository} from '../../modules/repositories/TariffRepository';
import RpcError from '../../rpc/RpcError';
import {roundCurrencyAmount} from '../../types/api/_currency';
import type {BillQuoteSeriesBucket} from '../../types/api/bill';
import type {
    EnergyQueryParams,
    EnergyQueryPricingSummary
} from '../../types/api/energy';
import {ENERGY_LIMITS} from '../../types/api/energy';
import {
    TARIFF_BANDS,
    type TariffBand,
    type TariffSpec
} from '../../types/api/tariff';
import {meteredRowsOrZero} from '../billing/meteredZero';
import {
    type BucketPricing,
    computeEnergyCost,
    type Energy15minCostRow
} from '../report/energyCostEngine';
import {
    assertQuantityCoverage,
    assertReturnedQuantityCoverage,
    buildEnergyCostRows,
    type QuantityCoverageInterval,
    resolveQuantityCoverageInterval
} from '../report/energyReportCost';
import {
    buildPerPointPricingPlan,
    type LivePriceReader,
    type PerPointPricingPlan,
    type TariffReader
} from '../report/energyReportTariffPoints';
import {convertGasVolume} from '../report/gasConversion';
import {selectGasProfile} from '../report/gasReportConversion';
import {
    quantityMetricForTags,
    type TariffQuantityMetric,
    tagsForQuantityMetric,
    tariffQuantityMetric
} from '../report/tariffQuantity';
import {seriesBucketEnd, seriesBucketStart} from './seriesBuckets';

export interface EnergyPricingSender {
    getOrganizationId(): string | undefined;
    hasCrudPermission?(component: 'reports', operation: 'read'): boolean;
}

export interface EnergyQueryPricingDeps {
    tariffRepo?: TariffReader;
    liveRepo?: LivePriceReader;
    gasRepo?: Pick<GasConversionRepository, 'resolveCalorificValues'> &
        Partial<Pick<GasConversionRepository, 'listProfiles'>> &
        Pick<GasConversionRepository, 'resolveProfile'>;
    /** Internal bill-quote seam. Public Energy.Query always keeps its 30-day cap. */
    allowLongRange?: boolean;
    /** Bill.Quote may expose explained leading gaps. */
    allowPartialQuantityCoverage?: boolean;
    /** Internal billing seam. A meter that resumed mid-period still owes money
     * for what it recorded, so Bill.Quote prices the covered sub-period and
     * reports it as partial; every other caller keeps the stricter refusal. */
    clampPartialQuantityCoverage?: boolean;
    captureQuantityCoverage?: (coverage: QuantityCoverageInterval) => void;
    /** Internal, already-authorized point narrowing for channel-scoped quotes. */
    includePoint?: (deviceExternalId: string, channel: number) => boolean;
    /** Internal billing seam. The rollup writes an energy bucket only when a
     * lifetime counter moved, so a live meter that consumed nothing records
     * nothing at all. Bill.Quote supplies the zero readings it can prove were
     * taken; every other caller keeps the no-recorded-data refusal. */
    readMeteredZeroRows?: (
        metric: TariffQuantityMetric
    ) => Promise<readonly Energy15minByChannelRow[]>;
    /** Internal billing seam. Public Energy.Query deliberately keeps its
     * aggregate response, while Bill.Quote can expose directly attributable
     * per-device usage without re-running or apportioning the aggregate bill. */
    captureDeviceUsage?: (
        items: readonly EnergyQueryPricingDeviceUsage[]
    ) => void;
    /** Internal billing seam, same contract as captureDeviceUsage but along
     * time instead of devices: Bill.Quote can expose the per-bucket measured
     * usage the 15-minute cost engine already computes. Selecting a bucket
     * changes what is captured, never what is charged. */
    seriesBucket?: BillQuoteSeriesBucket;
    captureBucketUsage?: (
        items: readonly EnergyQueryPricingBucketUsage[]
    ) => void;
    /** Internal billing seam, along the tariff's clock instead of time or
     * devices: the energy and money that landed in each named time-of-use
     * band. Only bands that priced something appear. */
    captureBandUsage?: (items: readonly EnergyQueryPricingBandUsage[]) => void;
    /** Internal PV counterfactual seam. Metering points Fleet has identified
     * as on-site generation (logical-meter role) inside the already-authorized
     * scope. Their energy is never billed here; it only sizes the avoided
     * import a self-consuming site did not pay for. */
    generationPoints?: readonly EnergyPricingPoint[];
    captureAvoidedImportCost?: (
        result: EnergyQueryPricingAvoidedImportCost
    ) => void;
}

export interface EnergyPricingPoint {
    device: string;
    channel: number;
}

/** Shared shape of an attributable usage slice — one device, or one bucket. */
interface EnergyQueryPricingUsage {
    status: EnergyQueryPricingSummary['status'];
    currency: string | null;
    billedUnit: string;
    quantity: number;
    pricedQuantity: number;
    unpricedQuantity: number;
    returnedQuantity: number;
    usageCharge: number | null;
    coveredUsageCharge: number;
    exportCredit: number | null;
    netUsageCharge: number | null;
    estimatedQuantity: number;
    tariffIds: number[];
    exportTariffIds: number[];
    assignmentSources: string[];
    exportAssignmentSources: string[];
    warnings: Array<{code: string; message: string}>;
    missingConfigurationReasons: string[];
}

export interface EnergyQueryPricingBucketUsage extends EnergyQueryPricingUsage {
    bucketStart: string;
    bucketEnd: string;
}

/** Measured usage priced inside one named time-of-use band. */
export interface EnergyQueryPricingBandUsage {
    band: TariffBand;
    quantity: number;
    usageCharge: number;
    /** Money over quantity. Null when the band measured nothing to divide by. */
    averagePrice: number | null;
}

/** Never a billed amount. See BillQuoteAvoidedImportCost for the contract. */
export interface EnergyQueryPricingAvoidedImportCost {
    status: 'estimated' | 'unavailable';
    currency: string | null;
    billedUnit: string;
    generationQuantity: number | null;
    exportedQuantity: number | null;
    selfConsumedQuantity: number | null;
    avoidedCost: number | null;
    tariffIds: number[];
    warnings: Array<{code: string; message: string}>;
    missingConfigurationReasons: string[];
}

export interface EnergyQueryPricingDeviceUsage extends EnergyQueryPricingUsage {
    device: string;
}

/** Mutable tally shared by the per-device and per-bucket breakdowns. Both slice
 * the same priced rows, so they must agree field for field or one of them is
 * lying about the same measurement. */
interface UsageAccumulator {
    hasMeasurement: boolean;
    importConfigured: boolean;
    exportConfigured: boolean;
    quantity: number;
    pricedQuantity: number;
    unpricedQuantity: number;
    returnedQuantity: number;
    unpricedReturnedQuantity: number;
    exportCredit: number;
    estimatedQuantity: number;
    tariffIds: Set<number>;
    exportTariffIds: Set<number>;
    assignmentSources: Set<string>;
    exportAssignmentSources: Set<string>;
    currencies: Set<string>;
    exportCurrencies: Set<string>;
}

interface DeviceUsageAccumulator extends UsageAccumulator {
    device: string;
}

interface BucketUsageAccumulator extends UsageAccumulator {
    bucketStart: Date;
}

export interface EnergyPricingScope {
    internalIds: readonly number[];
    idMap: Readonly<Record<number, string>>;
}

interface FallbackTariff {
    tariff: TariffSpec | null;
    source: 'explicit' | 'none';
}

export async function calculateEnergyQueryPricing(
    params: EnergyQueryParams,
    sender: EnergyPricingSender,
    repo: Pick<
        EnergyRepository,
        'queryEnergy15minByChannel' | 'resolveDeviceJoinDates'
    >,
    scope: EnergyPricingScope,
    deps: EnergyQueryPricingDeps = {}
): Promise<EnergyQueryPricingSummary> {
    assertEnergyQueryPricingRequest(params, sender, deps.allowLongRange);
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    const quantityMetric = pricingQuantityMetric(params);
    const tariffRepo = deps.tariffRepo ?? (await defaultTariffRepository());
    const fallback = await resolveFallbackTariff(params, orgId, tariffRepo);
    if (fallback.tariff) {
        assertCurrency(fallback.tariff);
        assertTariffQuantity(fallback.tariff, quantityMetric);
    }
    const explicitExportTariff = params.pricing?.exportTariffId
        ? await requiredTariff(tariffRepo, orgId, params.pricing.exportTariffId)
        : null;
    if (explicitExportTariff) {
        assertCurrency(explicitExportTariff);
        assertTariffQuantity(explicitExportTariff, quantityMetric);
    }
    if (fallback.tariff && explicitExportTariff) {
        assertMatchingImportExportUnits(fallback.tariff, explicitExportTariff);
    }
    if (explicitExportTariff?.kind === 'block') {
        // Blocks accumulate on metered consumption. Exported energy is not
        // consumption, so there is no block position to price it at.
        throw RpcError.Domain('ValidationFailed', {
            message:
                'A stepped (block) tariff prices consumption blocks and cannot price exported energy.',
            field: 'pricing.exportTariffId'
        });
    }

    const from = new Date(params.from);
    const to = new Date(params.to);
    const deviceMap = new Map<number, string>(
        Object.entries(scope.idMap).map(([id, shellyID]) => [
            Number(id),
            shellyID
        ])
    );
    const deviceUsage = new Map<number, DeviceUsageAccumulator>();
    for (const internalId of scope.internalIds) {
        const device = deviceMap.get(internalId);
        if (device) deviceUsage.set(internalId, emptyDeviceUsage(device));
    }
    const seriesBucket = deps.captureBucketUsage
        ? deps.seriesBucket
        : undefined;
    const bucketUsage = new Map<number, BucketUsageAccumulator>();
    const includePoint = deps.includePoint;
    const selectedPoints = (
        candidates: readonly Energy15minByChannelRow[]
    ): Energy15minByChannelRow[] =>
        includePoint
            ? candidates.filter((row) =>
                  includePoint(deviceMap.get(row.device) ?? '', row.channel)
              )
            : [...candidates];
    const measuredRows = selectedPoints(
        await repo.queryEnergy15minByChannel({
            internalIds: [...scope.internalIds],
            from,
            to,
            tags: tagsForQuantityMetric(quantityMetric),
            commodity: params.commodity,
            electricalSource: params.electricalSource
        })
    );
    const readZeroRows = deps.readMeteredZeroRows;
    const rawRows = readZeroRows
        ? await meteredRowsOrZero(measuredRows, async () =>
              selectedPoints(await readZeroRows(quantityMetric))
          )
        : measuredRows;
    const joinScope = {
        internalIds: scope.internalIds,
        readJoinDates: (ids: readonly number[]) =>
            repo.resolveDeviceJoinDates(ids)
    };
    if (deps.allowPartialQuantityCoverage) {
        const coverage = await resolveQuantityCoverageInterval(
            rawRows,
            from,
            to,
            quantityMetric,
            joinScope,
            {clampToRecorded: deps.clampPartialQuantityCoverage === true}
        );
        deps.captureQuantityCoverage?.(coverage);
    } else {
        await assertQuantityCoverage(rawRows, from, quantityMetric, joinScope);
    }
    const rows = buildEnergyCostRows(rawRows, quantityMetric);
    const points = [
        ...new Map(
            rows.map((row) => {
                const point = {
                    deviceExternalId: deviceMap.get(row.device) ?? '',
                    channel: row.channel,
                    commodity: quantityMetric.commodity,
                    direction: 'import' as const
                };
                return [`${point.deviceExternalId}|${point.channel}`, point];
            })
        ).values()
    ].filter((point) => point.deviceExternalId !== '');
    const plan = await buildPerPointPricingPlan({
        orgId,
        deviceMap,
        defaultTariff: fallback.tariff,
        from,
        to,
        // Only live tariffs use this classification. Each selected tariff's
        // timezone is applied by the shared pricing plan.
        rate: {
            tariffMode: 'single',
            tariff: 0,
            dayRate: 0,
            nightRate: 0,
            dayStartHour: 7,
            dayEndHour: 23,
            timezone: fallback.tariff?.timezone ?? null
        },
        tariffRepo,
        liveRepo: deps.liveRepo,
        strictAssignments: true,
        points,
        rows,
        quantityMetric,
        loadHistory: async (historyFrom, historyTo) => {
            const historyRows = await repo.queryEnergy15minByChannel({
                internalIds: [...scope.internalIds],
                from: historyFrom,
                to: historyTo,
                tags: [quantityMetric.consumptionTag],
                commodity: params.commodity,
                electricalSource: params.electricalSource
            });
            return buildEnergyCostRows(
                selectedPoints(historyRows),
                quantityMetric
            );
        }
    });
    const exportPlan = await buildPerPointPricingPlan({
        orgId,
        deviceMap,
        defaultTariff: explicitExportTariff,
        from,
        to,
        rate: {
            tariffMode: 'single',
            tariff: 0,
            dayRate: 0,
            nightRate: 0,
            dayStartHour: 7,
            dayEndHour: 23,
            timezone: explicitExportTariff?.timezone ?? null
        },
        tariffRepo,
        liveRepo: deps.liveRepo,
        strictAssignments: true,
        includeAssignments: explicitExportTariff === null,
        points: points.map((point) => ({...point, direction: 'export'})),
        rows,
        quantityMetric
    });
    if (
        quantityMetric.commodity === 'gas' &&
        (explicitExportTariff !== null || exportPlan.hasAssignments)
    ) {
        assertReturnedQuantityCoverage(
            rawRows,
            from,
            quantityMetric,
            rows
                .filter((row) => exportPlan.resolve(row).tariff !== null)
                .map((row) => ({device: row.device, channel: row.channel}))
        );
    }
    assertMeterRows(rows);
    const covered = [] as typeof rows;
    const pricingByRow = new Map<
        (typeof rows)[number],
        NonNullable<ReturnType<typeof plan.resolve>['pricing']>
    >();
    const currencies = new Set<string>();
    const tariffIds = new Set<number>();
    const exportTariffIds = new Set<number>();
    const exportCurrencies = new Set<string>();
    const sources = new Set<string>();
    const exportSources = new Set<string>();
    const billedUnits = new Set<string>();
    const exportBilledUnits = new Set<string>();
    const gasConversions = new Map<
        number,
        NonNullable<EnergyQueryPricingSummary['gasConversions']>[number]
    >();
    let consumptionKWh = 0;
    let returnedKWh = 0;
    let unpricedConsumptionKWh = 0;
    let exportCredit = 0;
    let unpricedReturnedKWh = 0;

    for (const row of rows) {
        const rawReturned = row.returnedUnits;
        const resolved = plan.resolve(row);
        const exportResolution = exportPlan.resolve(row);
        if (resolved.tariff && exportResolution.tariff) {
            assertMatchingImportExportUnits(
                resolved.tariff,
                exportResolution.tariff
            );
        }
        // Import and export gas quantities share one physical service point,
        // profile selection and calorific-value publication. Matching billed
        // units above lets us convert both directions once, then price them
        // independently without a second potentially different lookup.
        const conversionTariff =
            resolved.tariff ?? exportResolution.tariff ?? null;
        const converted = conversionTariff
            ? await convertGasPricingRow({
                  row,
                  tariff: conversionTariff,
                  rawMetric: quantityMetric,
                  orgId,
                  deviceExternalId: deviceMap.get(row.device) ?? '',
                  from,
                  to,
                  repo: deps.gasRepo
              })
            : {row, disclosure: null};
        const consumed = converted.row.consumptionUnits;
        const returned = converted.row.returnedUnits;
        const device = deviceUsage.get(row.device);
        // Both breakdowns tally the very same row; keeping them in one list
        // makes it impossible for the series to drift from the device rows.
        const tallies: UsageAccumulator[] = [];
        if (device) tallies.push(device);
        if (seriesBucket) {
            tallies.push(
                bucketAccumulatorFor(bucketUsage, row.bucket, seriesBucket)
            );
        }
        for (const tally of tallies) {
            tally.hasMeasurement = true;
            tally.quantity += consumed;
            tally.returnedQuantity += returned;
        }
        mergeGasDisclosure(gasConversions, converted.disclosure);
        let exportWasPriced = false;
        if (rawReturned > 0) {
            if (!exportResolution.pricing || !exportResolution.tariff) {
                if (explicitExportTariff) {
                    throw RpcError.Domain('ValidationFailed', {
                        message:
                            'The export tariff does not cover returned energy.',
                        field: 'pricing.exportTariffId'
                    });
                }
                // Keep this raw quantity deferred until import conversion is
                // known, so the public returnedQuantity remains in billedUnit.
            } else {
                if (exportResolution.tariff.kind === 'block') {
                    throw RpcError.Domain('ValidationFailed', {
                        message:
                            'A stepped (block) tariff prices consumption blocks and cannot price exported energy.',
                        field: 'pricing.exportTariffId'
                    });
                }
                assertCurrency(exportResolution.tariff);
                const exportMetric = tariffQuantityMetric(
                    exportResolution.tariff
                );
                if (!exportMetric) {
                    throw invalidTariffQuantity(exportResolution.tariff);
                }
                exportBilledUnits.add(exportMetric.billedUnit);
                exportCurrencies.add(exportResolution.tariff.currency);
                exportSources.add(exportResolution.source);
                for (const tally of tallies) {
                    tally.exportConfigured = true;
                    tally.exportCredit +=
                        returned * exportResolution.pricing.price;
                    tally.exportCurrencies.add(
                        exportResolution.tariff.currency
                    );
                    tally.exportAssignmentSources.add(exportResolution.source);
                }
                if (typeof exportResolution.tariff.id === 'number') {
                    exportTariffIds.add(exportResolution.tariff.id);
                    for (const tally of tallies) {
                        tally.exportTariffIds.add(exportResolution.tariff.id);
                    }
                }
                returnedKWh += returned;
                exportCredit += returned * exportResolution.pricing.price;
                exportWasPriced = true;
            }
        }
        if (!resolved.pricing || !resolved.tariff) {
            if (rawReturned > 0 && !exportWasPriced) {
                returnedKWh += returned;
                unpricedReturnedKWh += returned;
                for (const tally of tallies) {
                    tally.unpricedReturnedQuantity += returned;
                }
            }
            unpricedConsumptionKWh += consumed;
            consumptionKWh += consumed;
            for (const tally of tallies) tally.unpricedQuantity += consumed;
            continue;
        }
        consumptionKWh += consumed;
        if (rawReturned > 0 && !exportWasPriced) {
            returnedKWh += returned;
            unpricedReturnedKWh += returned;
            for (const tally of tallies) {
                tally.unpricedReturnedQuantity += returned;
            }
        }
        const configuredMetric = tariffQuantityMetric(resolved.tariff);
        if (!configuredMetric) throw invalidTariffQuantity(resolved.tariff);
        billedUnits.add(configuredMetric.billedUnit);
        assertCurrency(resolved.tariff);
        currencies.add(resolved.tariff.currency);
        for (const tally of tallies) {
            tally.importConfigured = true;
            tally.pricedQuantity += consumed;
            tally.currencies.add(resolved.tariff.currency);
            tally.assignmentSources.add(resolved.source);
            if (resolved.pricing.estimated) {
                tally.estimatedQuantity += consumed;
            }
        }
        if (typeof resolved.tariff.id === 'number') {
            tariffIds.add(resolved.tariff.id);
            for (const tally of tallies)
                tally.tariffIds.add(resolved.tariff.id);
        }
        sources.add(resolved.source);
        covered.push(converted.row);
        pricingByRow.set(converted.row, resolved.pricing);
    }
    if (currencies.size > 1) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `Pricing covers this scope with multiple currencies (${[...currencies].sort().join(', ')}). ` +
                'Split the query by tariff currency; Fleet does not invent an exchange rate.',
            field: 'pricing'
        });
    }
    if (exportCurrencies.size > 1) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `Export pricing covers this scope with multiple currencies (${[...exportCurrencies].sort().join(', ')}). ` +
                'Split the query by tariff currency; Fleet does not invent an exchange rate.',
            field: 'pricing'
        });
    }
    if (billedUnits.size > 1) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Pricing covers this scope with multiple billed units (${[...billedUnits].sort().join(', ')}). Split the query by billed unit.`,
            field: 'pricing'
        });
    }
    if (exportBilledUnits.size > 1) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Export pricing covers this scope with multiple billed units (${[...exportBilledUnits].sort().join(', ')}). Split the query by billed unit.`,
            field: 'pricing.exportTariffId'
        });
    }
    const importBilledUnit = billedUnits.values().next().value;
    const exportBilledUnit = exportBilledUnits.values().next().value;
    if (
        importBilledUnit &&
        exportBilledUnit &&
        importBilledUnit !== exportBilledUnit
    ) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `Import pricing uses billed unit ${importBilledUnit} while export pricing uses ${exportBilledUnit}. ` +
                'Split the query by billed unit; returned quantities cannot be relabeled.',
            field: 'pricing.exportTariffId'
        });
    }
    if (gasConversions.size > 0 && unpricedConsumptionKWh > 1e-12) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                'Converted gas pricing has uncovered meter rows whose billed quantity cannot be inferred. Split the query or complete tariff assignments.',
            field: 'pricing'
        });
    }

    // The cost engine already groups by a display bucket; with a series
    // requested that grouping IS the series, summed across devices/channels.
    const cost = computeEnergyCost(
        covered,
        (row) => pricingByRow.get(row)!,
        seriesBucket
            ? (row) =>
                  String(
                      seriesBucketStart(
                          new Date(row.bucket),
                          seriesBucket
                      ).getTime()
                  )
            : (row) => `${row.device}|${row.channel}|${row.bucket}`
    );
    const coveredConsumptionKWh = cost.totals.consumptionKWh;
    const hasUnpriced = unpricedConsumptionKWh > 1e-12;
    const configured =
        fallback.tariff !== null || plan.hasAssignments || covered.length > 0;
    const status: EnergyQueryPricingSummary['status'] = hasUnpriced
        ? coveredConsumptionKWh > 0
            ? 'partial'
            : 'unconfigured'
        : configured
          ? 'priced'
          : 'unconfigured';
    const currency =
        currencies.values().next().value ?? fallback.tariff?.currency;
    const exportCurrency = exportCurrencies.values().next().value;
    if (currency && exportCurrency && currency !== exportCurrency) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `Import pricing uses ${currency} while export pricing uses ${exportCurrency}. ` +
                'Fleet does not calculate a net value across currencies.',
            field: 'pricing.exportTariffId'
        });
    }
    const exportConfigured =
        explicitExportTariff !== null || exportPlan.hasAssignments;
    const authoritativeExport =
        exportConfigured && unpricedReturnedKWh <= 1e-12;
    const authoritativeNet =
        status === 'priced' && (returnedKWh <= 1e-12 || authoritativeExport);
    const roundedExportCredit = authoritativeExport
        ? money(exportCredit, exportCurrency ?? explicitExportTariff?.currency)
        : null;
    const billedUnit =
        importBilledUnit ?? exportBilledUnit ?? quantityMetric.billedUnit;
    deps.captureDeviceUsage?.(
        buildDeviceUsageBreakdown(deviceUsage, cost.perDevice, billedUnit)
    );
    if (seriesBucket && deps.captureBucketUsage) {
        deps.captureBucketUsage(
            buildBucketUsageSeries(
                bucketUsage,
                cost.perDisplayBucket,
                billedUnit,
                seriesBucket
            )
        );
    }
    deps.captureBandUsage?.(buildBandUsage(cost.perBand, currency));
    if (deps.captureAvoidedImportCost) {
        deps.captureAvoidedImportCost(
            await estimateAvoidedImportCost({
                generationPoints: deps.generationPoints ?? [],
                billedPoints: points,
                deviceMap,
                repo,
                rows,
                plan,
                from,
                to,
                params,
                quantityMetric,
                status,
                currency: currency ?? null,
                billedUnit,
                tariffIds
            })
        );
    }

    return {
        status,
        currency: currency ?? null,
        energyCost:
            status === 'priced' ? money(cost.totals.cost, currency) : null,
        coveredEnergyCost: money(cost.totals.cost, currency),
        consumptionQuantity: quantity(consumptionKWh),
        returnedQuantity: quantity(returnedKWh),
        coveredConsumptionQuantity: quantity(coveredConsumptionKWh),
        unpricedConsumptionQuantity: quantity(unpricedConsumptionKWh),
        estimatedQuantity: quantity(cost.estimatedKWh),
        consumptionKWh: quantity(consumptionKWh),
        returnedKWh: quantity(returnedKWh),
        coveredConsumptionKWh: quantity(coveredConsumptionKWh),
        unpricedConsumptionKWh: quantity(unpricedConsumptionKWh),
        dayEnergyCost: money(cost.totals.dayCost, currency),
        nightEnergyCost: money(cost.totals.nightCost, currency),
        estimatedKWh: quantity(cost.estimatedKWh),
        source: pricingSource(sources, fallback, covered.length > 0),
        assignmentSources: [...sources].sort(),
        tariffIds: [...tariffIds].sort((a, b) => a - b),
        exportCurrency:
            exportCurrency ?? explicitExportTariff?.currency ?? null,
        exportCredit: roundedExportCredit,
        netEnergyCost: authoritativeNet
            ? money(cost.totals.cost - (roundedExportCredit ?? 0), currency)
            : null,
        exportTariffId:
            explicitExportTariff?.id ??
            (exportTariffIds.size === 1
                ? (exportTariffIds.values().next().value ?? null)
                : null),
        exportTariffIds: [...exportTariffIds].sort((a, b) => a - b),
        exportSource: explicitExportTariff
            ? 'explicit'
            : exportPlan.hasAssignments
              ? 'assignments'
              : 'none',
        exportAssignmentSources: [...exportSources].sort(),
        billedUnit,
        ...(gasConversions.size
            ? {gasConversions: [...gasConversions.values()]}
            : {})
    };
}

/** Fail closed before Energy.Query performs its normal (potentially large) read. */
export function assertEnergyQueryPricingRequest(
    params: EnergyQueryParams,
    sender: EnergyPricingSender,
    allowLongRange = false
): void {
    if (!params.pricing) {
        throw RpcError.InvalidParams('pricing selector is required');
    }
    for (const [field, tariffId] of Object.entries({
        tariffId: params.pricing.tariffId,
        exportTariffId: params.pricing.exportTariffId
    })) {
        if (
            tariffId !== undefined &&
            (!Number.isInteger(tariffId) ||
                tariffId < 1 ||
                tariffId > ENERGY_LIMITS.maxTariffId)
        ) {
            throw RpcError.InvalidParams(
                `pricing.${field} must be an integer from 1 to ${ENERGY_LIMITS.maxTariffId}`
            );
        }
    }
    if (!sender.hasCrudPermission?.('reports', 'read')) {
        throw RpcError.PermissionDenied(true);
    }
    const metric =
        params.commodity === undefined
            ? null
            : quantityMetricForTags(params.commodity, params.tags);
    if (!metric) {
        throw RpcError.InvalidParams(
            'pricing requires one supported commodity quantity tag'
        );
    }
    if (
        params.commodity === 'electricity' &&
        params.electricalSource !== 'ac_mains'
    ) {
        throw RpcError.InvalidParams(
            "electricity pricing requires electricalSource='ac_mains'"
        );
    }
    const from = new Date(params.from);
    const to = new Date(params.to);
    if (
        !allowLongRange &&
        to.getTime() - from.getTime() > ENERGY_LIMITS.maxRangeMsSummary
    ) {
        throw RpcError.Domain('ValidationFailed', {
            message: 'Energy pricing is limited to 30 days per query',
            field: 'range'
        });
    }
}

function pricingQuantityMetric(params: EnergyQueryParams) {
    const metric =
        params.commodity === undefined
            ? null
            : quantityMetricForTags(params.commodity, params.tags);
    if (!metric) {
        throw RpcError.InvalidParams(
            'pricing requires one supported commodity quantity tag'
        );
    }
    return metric;
}

function assertTariffQuantity(
    tariff: TariffSpec,
    requested: ReturnType<typeof pricingQuantityMetric>
): void {
    const configured = tariffQuantityMetric(tariff);
    if (
        !configured ||
        configured.commodity !== requested.commodity ||
        (configured.billedUnit !== requested.billedUnit &&
            !(
                requested.commodity === 'gas' &&
                configured.requiresConversion === 'gas'
            ))
    ) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `Tariff ${tariff.id ?? '(unsaved)'} does not price ` +
                `${requested.commodity} in ${requested.billedUnit}.`,
            field: 'pricing.tariffId'
        });
    }
}

function invalidTariffQuantity(tariff: TariffSpec): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message: `Tariff ${tariff.id ?? '(unsaved)'} has an unsupported commodity/billed-unit pair.`,
        field: 'pricing.tariffId'
    });
}

function assertMatchingImportExportUnits(
    importTariff: TariffSpec,
    exportTariff: TariffSpec
): void {
    const importMetric = tariffQuantityMetric(importTariff);
    const exportMetric = tariffQuantityMetric(exportTariff);
    if (!importMetric || !exportMetric) return;
    if (importMetric.billedUnit === exportMetric.billedUnit) return;
    throw RpcError.Domain('ValidationFailed', {
        message:
            `Import pricing uses billed unit ${importMetric.billedUnit} while export pricing uses ${exportMetric.billedUnit}. ` +
            'Split the query by billed unit; returned quantities cannot be relabeled.',
        field: 'pricing.exportTariffId'
    });
}

/** Shared conversion seam for import and returned/export quantities. Exported
 * gas is a positive metered volume and must be converted before feed-in price
 * multiplication; callers must never relabel raw m3 as an energy unit. */
export async function convertGasPricingRow(input: {
    row: Energy15minCostRow;
    tariff: TariffSpec;
    rawMetric: TariffQuantityMetric;
    orgId: string;
    deviceExternalId: string;
    from: Date;
    to: Date;
    repo?: EnergyQueryPricingDeps['gasRepo'];
}) {
    const configured = tariffQuantityMetric(input.tariff);
    if (!configured) throw invalidTariffQuantity(input.tariff);
    if (configured.requiresConversion !== 'gas') {
        return {row: input.row, disclosure: null};
    }
    if (
        input.rawMetric.commodity !== 'gas' ||
        input.rawMetric.billedUnit !== 'm3'
    ) {
        throw invalidTariffQuantity(input.tariff);
    }
    if (
        Math.abs(input.row.consumptionUnits) <= 1e-12 &&
        Math.abs(input.row.returnedUnits) <= 1e-12
    ) {
        return {row: input.row, disclosure: null};
    }
    const repo = input.repo ?? (await defaultGasConversionRepository());
    const fromDay = input.from.toISOString().slice(0, 10);
    const toDay = new Date(input.to.getTime() - 1).toISOString().slice(0, 10);
    const profile = repo.listProfiles
        ? selectGasProfile(
              await repo.listProfiles({
                  orgId: input.orgId,
                  deviceExternalId: input.deviceExternalId,
                  channel: input.row.channel,
                  from: new Date(input.from.getTime() - 86_400_000)
                      .toISOString()
                      .slice(0, 10),
                  to: new Date(input.to.getTime() + 86_400_000)
                      .toISOString()
                      .slice(0, 10)
              }),
              input.row.bucket,
              configured.billedUnit,
              input.deviceExternalId,
              input.row.channel
          )
        : await repo.resolveProfile({
              orgId: input.orgId,
              deviceExternalId: input.deviceExternalId,
              channel: input.row.channel,
              from: fromDay,
              to: toDay
          });
    if (profile?.billedUnit !== configured.billedUnit) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Gas conversion profile billed unit '${profile?.billedUnit ?? 'missing'}' does not match tariff unit '${configured.billedUnit}'.`,
            field: 'gasConversion'
        });
    }
    const values = await repo.resolveCalorificValues({
        orgId: input.orgId,
        pricingZoneId: profile.pricingZoneId,
        from: new Date(input.from.getTime() - 86_400_000)
            .toISOString()
            .slice(0, 10),
        to: toDay
    });
    const consumption = convertGasQuantity(
        input.row.consumptionUnits,
        input.row.bucket,
        profile,
        values
    );
    const returned = convertGasQuantity(
        input.row.returnedUnits,
        input.row.bucket,
        profile,
        values
    );
    const result = consumption.result ?? returned.result!;
    return {
        row: {
            ...input.row,
            consumptionUnits: consumption.quantity,
            returnedUnits: returned.quantity
        },
        disclosure: {
            profileId: result.disclosure.profileId,
            profileRevision: result.disclosure.profileRevision,
            billedUnit: result.disclosure.billedUnit,
            calorificValueIds: result.disclosure.calorificValues.map(
                (v) => v.id
            ),
            calorificValueRevisions: result.disclosure.calorificValues.map(
                (v) => v.revision
            )
        }
    };
}

function convertGasQuantity(
    volume: number,
    bucket: string,
    profile: Parameters<typeof convertGasVolume>[0]['profile'],
    values: Parameters<typeof convertGasVolume>[0]['calorificValues']
) {
    if (Math.abs(volume) <= 1e-12) return {quantity: 0, result: null};
    const result = convertGasVolume({
        profile,
        calorificValues: values,
        rows: [{bucket, volume}]
    });
    return {quantity: result.billedQuantity, result};
}

function mergeGasDisclosure(
    disclosures: Map<
        number,
        NonNullable<EnergyQueryPricingSummary['gasConversions']>[number]
    >,
    disclosure:
        | NonNullable<EnergyQueryPricingSummary['gasConversions']>[number]
        | null
): void {
    if (!disclosure) return;
    const prior = disclosures.get(disclosure.profileId);
    const revisions = new Map<number, number>();
    for (const item of [prior, disclosure]) {
        if (!item) continue;
        item.calorificValueIds.forEach((id, index) => {
            revisions.set(id, item.calorificValueRevisions[index]);
        });
    }
    const calorificValueIds = [...revisions.keys()].sort(
        (left, right) => left - right
    );
    disclosures.set(disclosure.profileId, {
        ...disclosure,
        calorificValueIds,
        calorificValueRevisions: calorificValueIds.map(
            (id) => revisions.get(id)!
        )
    });
}

async function resolveFallbackTariff(
    params: EnergyQueryParams,
    orgId: string,
    tariffRepo: TariffReader
): Promise<FallbackTariff> {
    const explicitId = params.pricing?.tariffId;
    if (explicitId) {
        return {
            tariff: await requiredTariff(tariffRepo, orgId, explicitId),
            source: 'explicit'
        };
    }
    return {tariff: null, source: 'none'};
}

async function requiredTariff(
    repo: TariffReader,
    orgId: string,
    tariffId: number
): Promise<TariffSpec> {
    const tariff = await repo.get(orgId, tariffId);
    if (!tariff) throw RpcError.NotFound('tariff', String(tariffId));
    return tariff;
}

function assertCurrency(tariff: TariffSpec): void {
    if (!/^[A-Z]{3}$/.test(tariff.currency)) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Tariff ${tariff.id ?? '(unsaved)'} has invalid currency '${tariff.currency}'. Use a three-letter uppercase currency code.`,
            field: 'pricing.currency'
        });
    }
}

function assertMeterRows(
    rows: ReadonlyArray<{consumptionUnits: number; returnedUnits: number}>
): void {
    for (const row of rows) {
        if (
            !Number.isFinite(row.consumptionUnits) ||
            !Number.isFinite(row.returnedUnits) ||
            row.consumptionUnits < 0 ||
            row.returnedUnits < 0
        ) {
            throw RpcError.Domain('ValidationFailed', {
                message:
                    'Energy pricing received an invalid cumulative-energy delta; consumption and returned energy must be finite and non-negative.',
                field: 'energy'
            });
        }
    }
}

function pricingSource(
    sources: ReadonlySet<string>,
    fallback: FallbackTariff,
    hasCoveredRows: boolean
): EnergyQueryPricingSummary['source'] {
    const assignmentUsed = [...sources].some((source) =>
        source.endsWith('-assignment')
    );
    const fallbackUsed =
        sources.has('fallback') || (!hasCoveredRows && !!fallback.tariff);
    if (assignmentUsed && fallbackUsed) return 'mixed';
    if (assignmentUsed) return 'assignments';
    if (fallbackUsed)
        return fallback.source === 'none' ? 'none' : fallback.source;
    return 'none';
}
function emptyUsage(): UsageAccumulator {
    return {
        hasMeasurement: false,
        importConfigured: false,
        exportConfigured: false,
        quantity: 0,
        pricedQuantity: 0,
        unpricedQuantity: 0,
        returnedQuantity: 0,
        unpricedReturnedQuantity: 0,
        exportCredit: 0,
        estimatedQuantity: 0,
        tariffIds: new Set(),
        exportTariffIds: new Set(),
        assignmentSources: new Set(),
        exportAssignmentSources: new Set(),
        currencies: new Set(),
        exportCurrencies: new Set()
    };
}

function emptyDeviceUsage(device: string): DeviceUsageAccumulator {
    return {device, ...emptyUsage()};
}

/** The tally for the series bucket a 15-minute row falls in, created on first
 * use. Buckets with no measurement are never invented. */
function bucketAccumulatorFor(
    accumulators: Map<number, BucketUsageAccumulator>,
    rowBucket: string,
    seriesBucket: BillQuoteSeriesBucket
): BucketUsageAccumulator {
    const start = seriesBucketStart(new Date(rowBucket), seriesBucket);
    const key = start.getTime();
    const existing = accumulators.get(key);
    if (existing) return existing;
    const created: BucketUsageAccumulator = {
        bucketStart: start,
        ...emptyUsage()
    };
    accumulators.set(key, created);
    return created;
}

/** Coverage wording differs between a device row and a time bucket; the
 * arithmetic behind them must not. */
interface UsageWarningCopy {
    noMeasurement: string;
    importNotConfigured: string;
    partiallyPriced: string;
    notConfigured: string;
    exportNotConfigured: string;
}

const DEVICE_USAGE_COPY: UsageWarningCopy = {
    noMeasurement:
        'No measured utility quantity was found for this device and period.',
    importNotConfigured:
        'No import tariff assignment covers this device quantity.',
    partiallyPriced:
        'Some measured device quantity is not covered by an import tariff.',
    notConfigured: 'No tariff assignment covers this device.',
    exportNotConfigured:
        'Returned device quantity is not fully covered by an export tariff.'
};

const BUCKET_USAGE_COPY: UsageWarningCopy = {
    noMeasurement: 'No measured utility quantity was found for this bucket.',
    importNotConfigured:
        'No import tariff assignment covers this bucket quantity.',
    partiallyPriced:
        'Some measured quantity in this bucket is not covered by an import tariff.',
    notConfigured: 'No tariff assignment covers this bucket.',
    exportNotConfigured:
        'Returned quantity in this bucket is not fully covered by an export tariff.'
};

/** The one place a tally becomes a public usage row. Unpriced stays null; a
 * missing tariff is never rounded down to a confident zero. */
function buildUsageRow(
    item: UsageAccumulator,
    coveredUsageCharge: number,
    billedUnit: string,
    copy: UsageWarningCopy
): EnergyQueryPricingUsage {
    const usageAuthoritative =
        item.hasMeasurement &&
        item.unpricedQuantity <= 1e-12 &&
        (item.quantity <= 1e-12 || item.importConfigured);
    const exportAuthoritative =
        item.returnedQuantity <= 1e-12 ||
        (item.exportConfigured && item.unpricedReturnedQuantity <= 1e-12);
    const configured = item.importConfigured || item.exportConfigured;
    const hasMissingQuantity =
        item.unpricedQuantity > 1e-12 || item.unpricedReturnedQuantity > 1e-12;
    const status: EnergyQueryPricingSummary['status'] =
        !item.hasMeasurement || !configured
            ? 'unconfigured'
            : hasMissingQuantity
              ? 'partial'
              : 'priced';
    const currency =
        item.currencies.values().next().value ??
        item.exportCurrencies.values().next().value ??
        null;
    const usageCharge = usageAuthoritative
        ? money(coveredUsageCharge, currency)
        : null;
    const exportCredit = exportAuthoritative
        ? money(item.exportCredit, currency)
        : null;
    const missingConfigurationReasons: string[] = [];
    const warnings: Array<{code: string; message: string}> = [];
    const warn = (code: string, message: string) => {
        if (missingConfigurationReasons.includes(code)) return;
        missingConfigurationReasons.push(code);
        warnings.push({code, message});
    };
    if (!item.hasMeasurement) {
        warn('no_measured_quantity', copy.noMeasurement);
    } else if (!item.importConfigured && item.quantity > 1e-12) {
        warn('tariff_not_configured', copy.importNotConfigured);
    } else if (item.unpricedQuantity > 1e-12) {
        warn('partially_priced', copy.partiallyPriced);
    } else if (!configured) {
        warn('tariff_not_configured', copy.notConfigured);
    }
    if (item.unpricedReturnedQuantity > 1e-12) {
        warn('export_tariff_not_configured', copy.exportNotConfigured);
    }
    return {
        status,
        currency,
        billedUnit,
        quantity: quantity(item.quantity),
        pricedQuantity: quantity(item.pricedQuantity),
        unpricedQuantity: quantity(item.unpricedQuantity),
        returnedQuantity: quantity(item.returnedQuantity),
        usageCharge,
        coveredUsageCharge: money(coveredUsageCharge, currency),
        exportCredit,
        netUsageCharge:
            usageCharge !== null && exportCredit !== null
                ? money(usageCharge - exportCredit, currency)
                : null,
        estimatedQuantity: quantity(item.estimatedQuantity),
        tariffIds: [...item.tariffIds].sort((a, b) => a - b),
        exportTariffIds: [...item.exportTariffIds].sort((a, b) => a - b),
        assignmentSources: [...item.assignmentSources].sort(),
        exportAssignmentSources: [...item.exportAssignmentSources].sort(),
        warnings,
        missingConfigurationReasons
    };
}

function buildDeviceUsageBreakdown(
    accumulators: ReadonlyMap<number, DeviceUsageAccumulator>,
    costs: ReadonlyMap<number, {cost: number}>,
    billedUnit: string
): EnergyQueryPricingDeviceUsage[] {
    return [...accumulators.entries()]
        .map(([internalId, item]) => ({
            device: item.device,
            ...buildUsageRow(
                item,
                costs.get(internalId)?.cost ?? 0,
                billedUnit,
                DEVICE_USAGE_COPY
            )
        }))
        .sort((left, right) => left.device.localeCompare(right.device));
}

/** Usage only. Standing, demand, component and tax amounts stay on the whole
 * bill — apportioning them across bars would turn a chart into a fiction. */
function buildBucketUsageSeries(
    accumulators: ReadonlyMap<number, BucketUsageAccumulator>,
    costs: ReadonlyMap<string, {cost: number}>,
    billedUnit: string,
    seriesBucket: BillQuoteSeriesBucket
): EnergyQueryPricingBucketUsage[] {
    return [...accumulators.entries()]
        .sort(([left], [right]) => left - right)
        .map(([key, item]) => ({
            bucketStart: item.bucketStart.toISOString(),
            bucketEnd: seriesBucketEnd(
                item.bucketStart,
                seriesBucket
            ).toISOString(),
            ...buildUsageRow(
                item,
                costs.get(String(key))?.cost ?? 0,
                billedUnit,
                BUCKET_USAGE_COPY
            )
        }));
}

function unavailableAvoidedImportCost(
    billedUnit: string,
    currency: string | null,
    reasons: ReadonlyArray<{code: string; message: string}>
): EnergyQueryPricingAvoidedImportCost {
    return {
        status: 'unavailable',
        currency,
        billedUnit,
        generationQuantity: null,
        exportedQuantity: null,
        selfConsumedQuantity: null,
        avoidedCost: null,
        tariffIds: [],
        warnings: [...reasons],
        missingConfigurationReasons: reasons.map((reason) => reason.code)
    };
}

interface AvoidedImportCostRequest {
    generationPoints: readonly EnergyPricingPoint[];
    billedPoints: ReadonlyArray<{deviceExternalId: string; channel: number}>;
    deviceMap: ReadonlyMap<number, string>;
    repo: Pick<EnergyRepository, 'queryEnergy15minByChannel'>;
    rows: readonly Energy15minCostRow[];
    plan: PerPointPricingPlan;
    from: Date;
    to: Date;
    params: EnergyQueryParams;
    quantityMetric: TariffQuantityMetric;
    status: EnergyQueryPricingSummary['status'];
    currency: string | null;
    billedUnit: string;
    tariffIds: ReadonlySet<number>;
}

/**
 * Money the site did not spend because it consumed its own generation.
 *
 * This is a counterfactual, not a charge: it is what the self-consumed energy
 * WOULD have cost had it been imported. Fleet is the only component that can
 * state it honestly, because only Fleet knows the effective import price of
 * every 15-minute interval (time-of-use windows, day/night, live feeds).
 *
 * Self-consumption is measured, never modelled: metered generation minus the
 * energy exported at the billed points, floored at zero per interval. Every
 * input that is missing or ambiguous produces null, never zero.
 */
async function estimateAvoidedImportCost(
    req: AvoidedImportCostRequest
): Promise<EnergyQueryPricingAvoidedImportCost> {
    const unavailable = (code: string, message: string) =>
        unavailableAvoidedImportCost(req.billedUnit, req.currency, [
            {code, message}
        ]);
    if (req.quantityMetric.commodity !== 'electricity') {
        return unavailable(
            'counterfactual_unsupported_commodity',
            'Self-consumption avoided cost is defined for electricity only.'
        );
    }
    if (req.generationPoints.length === 0) {
        return unavailable(
            'generation_not_identified',
            'No on-site generation metering point with a generation logical-meter role was found inside this scope.'
        );
    }
    const billed = new Set(
        req.billedPoints.map(
            (point) => `${point.deviceExternalId}|${point.channel}`
        )
    );
    const overlapping = req.generationPoints.find((point) =>
        billed.has(`${point.device}|${point.channel}`)
    );
    if (overlapping) {
        return unavailable(
            'generation_point_is_billed',
            `Generation point ${overlapping.device}|${overlapping.channel} is also priced as billed consumption in this quote, so its energy cannot also be counted as avoided import.`
        );
    }
    if (req.status !== 'priced') {
        return unavailable(
            'import_pricing_incomplete',
            'Import pricing is not fully configured for this window, so there is no effective import price to value self-consumption at.'
        );
    }
    if (req.tariffIds.size !== 1) {
        return unavailable(
            'multiple_import_tariffs',
            'This scope resolves to more than one import tariff, so Fleet will not pick one to value avoided import at.'
        );
    }
    const internalIdOf = new Map(
        [...req.deviceMap.entries()].map(([internalId, external]) => [
            external,
            internalId
        ])
    );
    const generationKeys = new Set<string>();
    const generationIds = new Set<number>();
    for (const point of req.generationPoints) {
        const internalId = internalIdOf.get(point.device);
        if (internalId === undefined) continue;
        generationIds.add(internalId);
        generationKeys.add(`${internalId}|${point.channel}`);
    }
    if (generationIds.size === 0) {
        return unavailable(
            'generation_not_in_scope',
            'The identified generation meters are outside the authorized scope of this quote.'
        );
    }
    const generationRows = await req.repo.queryEnergy15minByChannel({
        internalIds: [...generationIds],
        from: req.from,
        to: req.to,
        tags: [req.quantityMetric.consumptionTag],
        commodity: req.params.commodity,
        electricalSource: req.params.electricalSource
    });
    const generationByBucket = new Map<string, number>();
    let generationTotal = 0;
    for (const row of buildEnergyCostRows(generationRows, req.quantityMetric)) {
        if (!generationKeys.has(`${row.device}|${row.channel}`)) continue;
        const bucket = new Date(row.bucket).toISOString();
        generationByBucket.set(
            bucket,
            (generationByBucket.get(bucket) ?? 0) + row.consumptionUnits
        );
        generationTotal += row.consumptionUnits;
    }
    if (generationByBucket.size === 0) {
        return unavailable(
            'no_generation_measurement',
            'The identified generation meters recorded no energy for this window.'
        );
    }
    const exportedByBucket = new Map<string, number>();
    let exportedTotal = 0;
    for (const row of req.rows) {
        if (row.returnedUnits <= 0) continue;
        const bucket = new Date(row.bucket).toISOString();
        exportedByBucket.set(
            bucket,
            (exportedByBucket.get(bucket) ?? 0) + row.returnedUnits
        );
        exportedTotal += row.returnedUnits;
    }
    // One tariff covers the whole scope, so any billed point resolves the same
    // price for a given interval; use a real one rather than a synthetic point.
    const reference = req.rows[0];
    if (!reference) {
        return unavailable(
            'no_billed_measurement',
            'This quote priced no measured import, so there is no resolved import price to value self-consumption at.'
        );
    }
    let selfConsumedTotal = 0;
    let avoidedCost = 0;
    for (const [bucket, generated] of generationByBucket) {
        const selfConsumed = generated - (exportedByBucket.get(bucket) ?? 0);
        if (!(selfConsumed > 0)) continue;
        const resolution = resolveCounterfactualPrice(req.plan, {
            device: reference.device,
            channel: reference.channel,
            bucket,
            consumptionUnits: selfConsumed,
            returnedUnits: 0
        });
        if (resolution === null) {
            return unavailable(
                'import_price_unresolved',
                `Fleet could not resolve an effective import price for ${bucket}, so the avoided cost is unknown rather than zero.`
            );
        }
        if (resolution.tariff.kind === 'block') {
            return unavailable(
                'block_tariff_counterfactual',
                'A stepped (block) import tariff prices cumulative consumption, so the price the avoided energy would have paid depends on a block position that did not occur. Fleet will not guess it.'
            );
        }
        selfConsumedTotal += selfConsumed;
        avoidedCost += selfConsumed * resolution.pricing.price;
    }
    return {
        status: 'estimated',
        currency: req.currency,
        billedUnit: req.billedUnit,
        generationQuantity: quantity(generationTotal),
        exportedQuantity: quantity(exportedTotal),
        selfConsumedQuantity: quantity(selfConsumedTotal),
        avoidedCost: money(avoidedCost, req.currency),
        tariffIds: [...req.tariffIds].sort((a, b) => a - b),
        warnings: [
            {
                code: 'counterfactual_estimate',
                message:
                    'Avoided import cost is an estimate of a cost that was never billed. It is not part of usageCharge, exportCredit or netCost.'
            }
        ],
        missingConfigurationReasons: []
    };
}

/** A counterfactual must never break a real bill: an unpriceable interval
 * degrades this estimate to "unknown", it does not fail the quote. */
function resolveCounterfactualPrice(
    plan: PerPointPricingPlan,
    row: Energy15minCostRow
): {tariff: TariffSpec; pricing: BucketPricing} | null {
    try {
        const resolved = plan.resolve(row);
        if (!resolved.tariff || !resolved.pricing) return null;
        return {tariff: resolved.tariff, pricing: resolved.pricing};
    } catch (error) {
        if (error instanceof RpcError) return null;
        throw error;
    }
}

/** Vocabulary order, so a chart's slices do not reorder between quotes. */
function buildBandUsage(
    perBand: ReadonlyMap<TariffBand, {consumptionKWh: number; cost: number}>,
    currency: string | null | undefined
): EnergyQueryPricingBandUsage[] {
    const items: EnergyQueryPricingBandUsage[] = [];
    for (const band of TARIFF_BANDS) {
        const totals = perBand.get(band);
        if (!totals) continue;
        items.push({
            band,
            quantity: quantity(totals.consumptionKWh),
            usageCharge: money(totals.cost, currency),
            averagePrice:
                Math.abs(totals.consumptionKWh) > 1e-12
                    ? totals.cost / totals.consumptionKWh
                    : null
        });
    }
    return items;
}

function money(value: number, currency: string | null | undefined): number {
    return roundCurrencyAmount(value, currency);
}

function quantity(value: number): number {
    return +value.toFixed(12);
}
