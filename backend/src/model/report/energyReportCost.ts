// Report cost pass: read 15-minute per-channel energy and price each piece in
// local time, so day/night/seasonal cost is correct at any display granularity.

import type {
    Energy15minByChannelRow,
    EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import {defaultLiveTariffRepository} from '../../modules/repositories/LiveTariffRepository';
import {NO_RECORDED_DATA_REASON} from '../../modules/rpcFailureLog';
import RpcError from '../../rpc/RpcError';
import type {TariffSpec} from '../../types/api/tariff';
import {
    type BucketPricing,
    type CostPriceResolver,
    computeEnergyCost,
    type Energy15minCostRow,
    type EnergyCostResult
} from './energyCostEngine';
import {billingPeriodBounds, billingPeriodIndexAt} from './reportPeriod';
import {isDayHour, type RateContext, resolveEnergyRate} from './rowEconomics';
import {
    type BlockPriceIndex,
    blockBucketsFromRows,
    buildBlockPriceIndex
} from './tariffBlockCharges';
import {
    storedQuantityToBilled,
    type TariffQuantityMetric,
    tagsForQuantityMetric,
    tariffQuantityMetric
} from './tariffQuantity';
import {resolveTariffPricing, tariffContractCovers} from './tariffResolver';

const ELECTRICITY_QUANTITY_METRIC = defaultElectricityQuantityMetric();

function defaultElectricityQuantityMetric(): TariffQuantityMetric {
    const metric = tariffQuantityMetric({});
    if (!metric) {
        throw new Error(
            'the default electricity/kWh tariff quantity is missing'
        );
    }
    return metric;
}

// Merge the two energy tags into one row per (device, channel, bucket).
export function buildEnergyCostRows(
    rows: readonly Energy15minByChannelRow[],
    metric: TariffQuantityMetric = ELECTRICITY_QUANTITY_METRIC
): Energy15minCostRow[] {
    const merged = new Map<string, Energy15minCostRow>();
    for (const r of rows) {
        const key = `${r.device}|${r.channel}|${r.bucket}`;
        let row = merged.get(key);
        if (!row) {
            row = {
                device: r.device,
                channel: r.channel,
                bucket: r.bucket,
                consumptionUnits: 0,
                returnedUnits: 0
            };
            merged.set(key, row);
        }
        const quantity = storedQuantityToBilled(r.energy_wh, metric);
        if (r.tag === metric.consumptionTag) {
            row.consumptionUnits += quantity;
        } else if (r.tag === metric.returnedTag) {
            row.returnedUnits += quantity;
        } else {
            throw new Error(
                `tag '${r.tag}' has no ${metric.commodity}/${metric.billedUnit} billing mapping`
            );
        }
    }
    return [...merged.values()];
}

// When the devices a request asked about joined the fleet. Read lazily: only a
// refusal needs the dates, so a priced read never pays for the lookup.
export interface FleetJoinScope {
    /** Every device in the requested scope, not only the ones with rows. */
    internalIds: readonly number[];
    readJoinDates(
        internalIds: readonly number[]
    ): Promise<ReadonlyMap<number, Date | null>>;
}

/** Fleet-supported interval for an honest quote. */
export interface QuantityCoverageInterval {
    status: 'complete' | 'partial';
    requestedFrom: Date;
    requestedTo: Date;
    coveredFrom: Date;
    coveredTo: Date;
    fraction: number;
}

export interface QuantityCoverageOptions {
    /**
     * Report the sub-period the fleet actually recorded instead of refusing a
     * range whose data starts late. A meter that resumed mid-period still owes
     * money for what it did record, and a report over it still has something
     * true to show. The covered window ends where it always has: absence of
     * buckets at the tail is not evidence of silence, because an unmoved
     * counter writes none.
     */
    clampToRecorded?: boolean;
}

export async function resolveQuantityCoverageInterval(
    rows: readonly {bucket: string}[],
    requestedFrom: Date,
    requestedTo: Date,
    metric: TariffQuantityMetric,
    joinScope: FleetJoinScope | null,
    options: QuantityCoverageOptions = {}
): Promise<QuantityCoverageInterval> {
    // No instant lies inside an empty or inverted window, so nothing can cover
    // it. Guarded here, the one entry point, so no branch can build an
    // interval whose end precedes its start.
    if (requestedTo.getTime() <= requestedFrom.getTime()) {
        throw coverageRefusal(
            `No recorded ${metric.commodity}/${metric.consumptionTag} ` +
                'data can cover a period that ends at or before it begins.',
            false
        );
    }
    const firstBucket = firstRecordedBucket(rows);
    if (!firstBucket) {
        const joinedLate = await joinedAfter(joinScope, requestedFrom);
        throw coverageRefusal(
            joinedLate
                ? `No recorded ${metric.commodity}/${metric.consumptionTag} ` +
                      'data is available for the requested billing period; ' +
                      'every device in scope joined the fleet after it began.'
                : `No recorded ${metric.commodity}/${metric.consumptionTag} ` +
                      'data is available for the requested billing period.',
            joinedLate
        );
    }
    if (firstBucket.getTime() <= requestedFrom.getTime()) {
        return coverageInterval(requestedFrom, requestedTo, requestedFrom);
    }
    const joinedLate = await joinedAfter(joinScope, requestedFrom);
    if (!joinedLate && !options.clampToRecorded) {
        throw coverageRefusal(
            `Recorded ${metric.commodity}/${metric.consumptionTag} ` +
                `coverage starts at ${firstBucket.toISOString()}; the ` +
                'requested period begins earlier and cannot be inferred as zero.',
            false
        );
    }
    // A window whose first reading lands on or after its end overlaps nothing,
    // so there is no covered sub-period to price.
    if (firstBucket.getTime() >= requestedTo.getTime()) {
        throw coverageRefusal(
            `No recorded ${metric.commodity}/${metric.consumptionTag} ` +
                'data overlaps the requested billing period.',
            joinedLate
        );
    }
    return coverageInterval(requestedFrom, requestedTo, firstBucket);
}

// Coverage always runs to the end that was asked for; only the start can move.
function coverageInterval(
    requestedFrom: Date,
    requestedTo: Date,
    coveredFrom: Date
): QuantityCoverageInterval {
    const requestedMs = requestedTo.getTime() - requestedFrom.getTime();
    const coveredMs = requestedTo.getTime() - coveredFrom.getTime();
    const complete = coveredFrom.getTime() <= requestedFrom.getTime();
    return {
        status: complete ? 'complete' : 'partial',
        requestedFrom,
        requestedTo,
        coveredFrom,
        coveredTo: requestedTo,
        fraction: complete
            ? 1
            : Math.max(
                  0,
                  Math.min(1, requestedMs > 0 ? coveredMs / requestedMs : 0)
              )
    };
}

export async function assertQuantityCoverage(
    rows: readonly Energy15minByChannelRow[],
    requestedFrom: Date,
    metric: TariffQuantityMetric,
    joinScope: FleetJoinScope | null
): Promise<void> {
    const firstBucket = firstRecordedBucket(rows);
    if (!firstBucket) {
        // Nothing at all is normal before a device joined and a dead meter
        // after, so the fleet's own join dates decide which one this is.
        const joinedLate = await joinedAfter(joinScope, requestedFrom);
        throw coverageRefusal(
            joinedLate
                ? `No recorded ${metric.commodity}/${metric.consumptionTag} ` +
                      'data is available for the requested billing period; ' +
                      'every device in scope joined the fleet after it began.'
                : `No recorded ${metric.commodity}/${metric.consumptionTag} ` +
                      'data is available for the requested billing period.',
            joinedLate
        );
    }
    if (firstBucket.getTime() > requestedFrom.getTime()) {
        const joinedLate = await joinedAfter(joinScope, requestedFrom);
        throw coverageRefusal(
            joinedLate
                ? `Recorded ${metric.commodity}/${metric.consumptionTag} ` +
                      `coverage starts at ${firstBucket.toISOString()}; every ` +
                      'device in scope joined the fleet after the requested ' +
                      'period began.'
                : `Recorded ${metric.commodity}/${metric.consumptionTag} ` +
                      `coverage starts at ${firstBucket.toISOString()}; the ` +
                      'requested period begins earlier and cannot be inferred ' +
                      'as zero.',
            joinedLate
        );
    }
}

function firstRecordedBucket(
    rows: readonly {bucket: string}[]
): Date | undefined {
    return rows
        .map((row) => new Date(row.bucket))
        .filter((bucket) => Number.isFinite(bucket.getTime()))
        .sort((left, right) => left.getTime() - right.getTime())[0];
}

// A refusal the fleet's own history explains is stamped quiet; an unexplained
// one keeps the level it has always had.
function coverageRefusal(message: string, explained: boolean): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message,
        field: 'range',
        ...(explained ? {details: {reason: NO_RECORDED_DATA_REASON}} : {})
    });
}

// True only when every device in scope joined at or after the period start.
// An absent or unreadable date decides nothing, so the refusal stays loud.
async function joinedAfter(
    joinScope: FleetJoinScope | null,
    requestedFrom: Date
): Promise<boolean> {
    if (!joinScope || joinScope.internalIds.length === 0) return false;
    let joined: ReadonlyMap<number, Date | null>;
    try {
        joined = await joinScope.readJoinDates(joinScope.internalIds);
    } catch {
        return false;
    }
    for (const internalId of joinScope.internalIds) {
        const at = joined.get(internalId);
        if (!at || !Number.isFinite(at.getTime())) return false;
        if (at.getTime() < requestedFrom.getTime()) return false;
    }
    return true;
}

/** An export tariff is authoritative only when every covered service point has
 * a real returned-direction counter from the beginning of the requested
 * period. A missing counter is not evidence of zero injection. */
export function assertReturnedQuantityCoverage(
    rows: readonly Energy15minByChannelRow[],
    requestedFrom: Date,
    metric: TariffQuantityMetric,
    points: readonly {device: number; channel: number}[]
): void {
    if (points.length === 0) return;
    if (!metric.returnedTag) {
        throw RpcError.Domain('ValidationFailed', {
            message: `${metric.commodity}/${metric.billedUnit} has no canonical returned-direction measurement tag.`,
            field: 'meterDirection'
        });
    }
    const firstReturned = new Map<string, Date>();
    for (const row of rows) {
        if (row.tag !== metric.returnedTag) continue;
        const at = new Date(row.bucket);
        if (!Number.isFinite(at.getTime())) continue;
        const key = `${row.device}|${row.channel}`;
        const prior = firstReturned.get(key);
        if (!prior || at < prior) firstReturned.set(key, at);
    }
    for (const point of uniqueQuantityPoints(points)) {
        const key = `${point.device}|${point.channel}`;
        const first = firstReturned.get(key);
        if (!first) {
            throw RpcError.Domain('ValidationFailed', {
                message:
                    `Export pricing requires recorded '${metric.returnedTag}' coverage for ` +
                    `device ${point.device} channel ${point.channel}; missing direction data cannot be inferred as zero.`,
                field: 'meterDirection'
            });
        }
        if (first.getTime() > requestedFrom.getTime()) {
            throw RpcError.Domain('ValidationFailed', {
                message:
                    `Recorded ${metric.returnedTag} coverage for device ${point.device} channel ${point.channel} ` +
                    `starts at ${first.toISOString()}; the requested period begins earlier and cannot be inferred as zero.`,
                field: 'meterDirection'
            });
        }
    }
}

function uniqueQuantityPoints(
    points: readonly {device: number; channel: number}[]
): Array<{device: number; channel: number}> {
    return [
        ...new Map(
            points.map((point) => [`${point.device}|${point.channel}`, point])
        ).values()
    ];
}

// Legacy resolver: flat tariff or day/night rates, classified by local hour.
function legacyPriceResolver(rate: RateContext): CostPriceResolver {
    return (row) => {
        const at = new Date(row.bucket);
        return {price: resolveEnergyRate(at, rate), isDay: isDayHour(at, rate)};
    };
}

// Sorted live price series, newest-last. One home for the per-tariff lookup.
export type LiveSeries = ReadonlyArray<{t: number; price: number}>;

export interface LivePricePoint {
    ts: string;
    price: number;
}

// Sort a price series once for repeated lookups (newest-last by time).
export function sortLiveSeries(
    prices: ReadonlyArray<LivePricePoint>
): Array<{t: number; price: number}> {
    return prices
        .map((p) => ({t: new Date(p.ts).getTime(), price: p.price}))
        .sort((a, b) => a.t - b.t);
}

// The price in effect at an instant = the last point at or before it, or null
// when the series has no point yet (caller fails loud rather than billing 0).
export function livePriceAt(
    sorted: ReadonlyArray<{t: number; price: number}>,
    bucketIso: string
): number | null {
    const t = new Date(bucketIso).getTime();
    let lo = 0;
    let hi = sorted.length - 1;
    let idx = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].t <= t) {
            idx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return idx >= 0 ? sorted[idx].price : null;
}

// One home for pricing a tariff at a bucket. Live tariffs price off the series
// and split day/night by the clock; stored tariffs resolve their own windows.
// Shared by the single-tariff and per-channel resolvers.
export function resolveBucketPricing(
    tariff: TariffSpec,
    bucket: string,
    ctx: {
        series: LiveSeries;
        rate: RateContext;
        blocks?: BlockPriceIndex | null;
    }
): BucketPricing {
    if (tariff.kind === 'block') {
        if (!tariffContractCovers(tariff, new Date(bucket))) {
            throw unpricedBucket(tariff, bucket);
        }
        const price = ctx.blocks?.priceAt(bucket);
        if (price == null) throw unindexedBlockBucket(tariff, bucket);
        // Blocks price cumulative period usage, not the clock, so there is no
        // peak/off-peak of their own; the report's day window classifies the
        // bucket exactly as it does for a live tariff.
        return {price, isDay: isDayHour(new Date(bucket), ctx.rate)};
    }
    if (tariff.kind === 'live' && typeof tariff.id === 'number') {
        const price = livePriceAt(ctx.series, bucket);
        if (price != null) {
            return {price, isDay: isDayHour(new Date(bucket), ctx.rate)};
        }
        // VEE: bucket before the first price (leading gap) — carry the earliest
        // price back, flag estimated, don't fail. Empty series still fails loud.
        const earliest = ctx.series[0]?.price;
        if (earliest == null) throw noLivePrice(tariff, bucket);
        return {
            price: earliest,
            isDay: isDayHour(new Date(bucket), ctx.rate),
            estimated: true
        };
    }
    const pricing = resolveTariffPricing(tariff, new Date(bucket));
    if (!pricing) throw unpricedBucket(tariff, bucket);
    return pricing;
}

// A live tariff with an empty series has no prices at all — nothing to carry
// forward, so fail loud rather than invent a number.
function noLivePrice(tariff: TariffSpec, bucket: string): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message:
            `Live tariff ${tariff.id ?? '(unsaved)'} has no price for ${bucket}` +
            ` — the live price feed has not delivered that period.`,
        field: 'tariff'
    });
}

// A stored tariff with full year+window coverage always resolves. Reaching
// here means a coverage gap slipped past validation (e.g. legacy data) —
// surface it loudly instead of billing the energy at 0.
function unpricedBucket(tariff: TariffSpec, bucket: string): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message:
            `Tariff ${tariff.id ?? '(unsaved)'} has no price window covering ` +
            `${bucket}. Fix the tariff's season/window coverage.`,
        field: 'tariff'
    });
}

// A block tariff can only be priced once the period's usage has been walked in
// order. Reaching here means a caller resolved a block bucket without building
// that index — surface it instead of inventing a rate.
function unindexedBlockBucket(tariff: TariffSpec, bucket: string): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message:
            `Tariff ${tariff.id ?? '(unsaved)'} prices in consumption blocks, ` +
            `which need the billing period's usage up to ${bucket}. This read ` +
            'path did not supply it.',
        field: 'tariff'
    });
}

/**
 * Block index for a stored block tariff over `internalIds`.
 *
 * The read starts at the opening anchor of the billing period `from` falls in,
 * not at `from`: a mid-period report that restarted the blocks at zero would
 * bill every unit at the cheapest block and undercharge the period.
 */
export async function buildTariffBlockIndex(input: {
    repo: Pick<EnergyRepository, 'queryEnergy15minByChannel'>;
    internalIds: readonly number[];
    tariff: TariffSpec;
    from: Date;
    to: Date;
}): Promise<BlockPriceIndex> {
    const {tariff} = input;
    if (!tariff.blocks) throw missingBlocks(tariff);
    const quantityMetric = tariffQuantityMetric(tariff);
    if (!quantityMetric) throw unsupportedQuantity(tariff);
    const rows = await input.repo.queryEnergy15minByChannel({
        internalIds: [...input.internalIds],
        from: blockAccumulationStart(tariff, input.from),
        to: input.to,
        tags: [quantityMetric.consumptionTag],
        commodity: quantityMetric.commodity
    });
    return buildBlockPriceIndex({
        blocks: tariff.blocks,
        timezone: tariff.timezone,
        billingDay: tariff.billingDay,
        buckets: blockBucketsFromRows(
            rows.map((row) => ({
                bucket: row.bucket,
                consumptionUnits: storedQuantityToBilled(
                    row.energy_wh,
                    quantityMetric
                )
            })),
            (at) => tariffContractCovers(tariff, at)
        )
    });
}

function unsupportedQuantity(tariff: TariffSpec): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message: `Tariff ${tariff.id ?? '(unsaved)'} has an unsupported commodity/billed-unit pair.`,
        field: 'tariff.billedUnit'
    });
}

/** Opening anchor of the billing period `from` falls in, in the tariff's zone. */
export function blockAccumulationStart(tariff: TariffSpec, from: Date): Date {
    return billingPeriodBounds(
        billingPeriodIndexAt(from, tariff.timezone, tariff.billingDay),
        tariff.billingDay,
        tariff.timezone
    ).from;
}

// kind='block' without a blocks payload cannot price anything. Validation
// rejects it at write time, so this only fires on data written before the
// constraint existed or edited outside the API.
function missingBlocks(tariff: TariffSpec): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message:
            `Tariff ${tariff.id ?? '(unsaved)'} has kind 'block' but no ` +
            'consumption blocks. Add its blocks before billing with it.',
        field: 'tariff.blocks'
    });
}

// Sorted live series for a live tariff, else empty.
export async function liveSeriesForTariff(
    tariff: TariffSpec,
    from: Date,
    to: Date
): Promise<LiveSeries> {
    if (tariff.kind !== 'live' || typeof tariff.id !== 'number') return [];
    const liveRepo = await defaultLiveTariffRepository();
    return sortLiveSeries(await liveRepo.getPrices(tariff.id, from, to));
}

export async function buildCostPriceResolver(
    req: CostPassRequest
): Promise<CostPriceResolver> {
    if (req.resolverOverride) return req.resolverOverride;
    if (!req.tariff) return legacyPriceResolver(req.rate);
    const tariff = req.tariff;
    const series = await liveSeriesForTariff(tariff, req.from, req.to);
    const blocks =
        tariff.kind === 'block'
            ? await buildTariffBlockIndex({
                  repo: req.repo,
                  internalIds: req.internalIds,
                  tariff,
                  from: req.from,
                  to: req.to
              })
            : null;
    return (row) =>
        resolveBucketPricing(tariff, row.bucket, {
            series,
            rate: req.rate,
            blocks
        });
}

// Truncate a UTC instant to the display bucket, matching DB time_bucket.
function truncUtc(date: Date, granularity: string): Date {
    const d = new Date(date);
    d.setUTCMilliseconds(0);
    d.setUTCSeconds(0);
    d.setUTCMinutes(0);
    if (granularity === 'hour') return d;
    d.setUTCHours(0);
    if (granularity === 'month') d.setUTCDate(1);
    return d;
}

// Shared key for splicing 15-min costs onto a display row (bucket + device).
export function displayBucketKey(
    bucketIso: string | Date,
    granularity: string,
    device: number
): string {
    return `${truncUtc(new Date(bucketIso), granularity).getTime()}::${device}`;
}

export interface CostPassRequest {
    repo: EnergyRepository;
    internalIds: number[];
    from: Date;
    to: Date;
    granularity: string;
    rate: RateContext;
    // When set, prices from the stored tariff instead of the inline rate.
    tariff?: TariffSpec | null;
    // When set, prices each row directly (per-channel/device assignments).
    resolverOverride?: CostPriceResolver | null;
    /** Quantity conversion selected by the report/request tariff. */
    quantityMetric?: TariffQuantityMetric;
}

export async function runEnergyCostPass(
    req: CostPassRequest
): Promise<EnergyCostResult> {
    const quantityMetric =
        req.quantityMetric ??
        (req.tariff ? tariffQuantityMetric(req.tariff) : null) ??
        ELECTRICITY_QUANTITY_METRIC;
    const rows = await req.repo.queryEnergy15minByChannel({
        internalIds: req.internalIds,
        from: req.from,
        to: req.to,
        tags: tagsForQuantityMetric(quantityMetric),
        commodity: quantityMetric.commodity
    });
    await assertQuantityCoverage(rows, req.from, quantityMetric, {
        internalIds: req.internalIds,
        readJoinDates: (ids) => req.repo.resolveDeviceJoinDates(ids)
    });
    const resolver = await buildCostPriceResolver(req);
    return computeEnergyCost(
        buildEnergyCostRows(rows, quantityMetric),
        resolver,
        (row) => displayBucketKey(row.bucket, req.granularity, row.device)
    );
}
