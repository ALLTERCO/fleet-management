// Report cost pass: read 15-minute per-channel energy and price each piece in
// local time, so day/night/seasonal cost is correct at any display granularity.

import type {
    Energy15minByChannelRow,
    EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import {defaultLiveTariffRepository} from '../../modules/repositories/LiveTariffRepository';
import RpcError from '../../rpc/RpcError';
import type {TariffSpec} from '../../types/api/tariff';
import {
    type BucketPricing,
    type CostPriceResolver,
    computeEnergyCost,
    type Energy15minCostRow,
    type EnergyCostResult
} from './energyCostEngine';
import {isDayHour, type RateContext, resolveEnergyRate} from './rowEconomics';
import {resolveTariffPricing} from './tariffResolver';

const COST_TAGS = ['total_act_energy', 'total_act_ret_energy'] as const;

// Merge the two energy tags into one row per (device, channel, bucket).
function buildCostRows(
    rows: readonly Energy15minByChannelRow[]
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
                consumptionWh: 0,
                returnedWh: 0
            };
            merged.set(key, row);
        }
        if (r.tag === 'total_act_energy') row.consumptionWh += r.energy_wh;
        else if (r.tag === 'total_act_ret_energy')
            row.returnedWh += r.energy_wh;
    }
    return [...merged.values()];
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
    ctx: {series: LiveSeries; rate: RateContext}
): BucketPricing {
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

async function buildResolver(req: CostPassRequest): Promise<CostPriceResolver> {
    if (req.resolverOverride) return req.resolverOverride;
    if (!req.tariff) return legacyPriceResolver(req.rate);
    const tariff = req.tariff;
    const series = await liveSeriesForTariff(tariff, req.from, req.to);
    return (row) =>
        resolveBucketPricing(tariff, row.bucket, {series, rate: req.rate});
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
}

export async function runEnergyCostPass(
    req: CostPassRequest
): Promise<EnergyCostResult> {
    const rows = await req.repo.queryEnergy15minByChannel({
        internalIds: req.internalIds,
        from: req.from,
        to: req.to,
        tags: COST_TAGS
    });
    const resolver = await buildResolver(req);
    return computeEnergyCost(buildCostRows(rows), resolver, (row) =>
        displayBucketKey(row.bucket, req.granularity, row.device)
    );
}
