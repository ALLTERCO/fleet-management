// Stepped (block) tariff maths: the charge for a billing period's consumption
// when a utility prices in ordered blocks (DEWA: 0-2000 kWh @ 0.230,
// 2001-4000 @ 0.280, 4001-6000 @ 0.320, 6001+ @ 0.380).
//
// Marginal, never flat-rate-by-bracket. Only the part of the period's use that
// falls inside a block pays that block's rate; crossing a line never reprices
// the units below it. That is why one unit saved is worth the TOP rate the
// period is paying, not the average.
//
// Blocks accumulate over the tariff's billing period and reset on its local
// anchor (`timezone` + `billingDay`), never on UTC — reusing the same anchor
// arithmetic the standing and demand charges bill on.
//
// Semantics are pinned to the reference implementation the Oasis template
// bills with (`usePriceSteps.ts`: steppedCharge, marginalUnitPrice) so the two
// agree to the cent.

import type {
    TariffBlockSpec,
    TariffBlockStepSpec
} from '../../types/api/tariff';
import {billingPeriodIndexAt} from './reportPeriod';

/** Lower and upper bound of one block, in the billed unit. */
function blockBounds(
    steps: readonly TariffBlockStepSpec[],
    index: number
): {from: number; to: number} {
    const from =
        index === 0 ? 0 : (steps[index - 1].upTo ?? Number.POSITIVE_INFINITY);
    return {from, to: steps[index].upTo ?? Number.POSITIVE_INFINITY};
}

/**
 * The charge for `units`, each part priced at the block it falls in.
 * Progressive, never retroactive.
 */
export function steppedCharge(
    units: number,
    steps: readonly TariffBlockStepSpec[]
): number {
    if (!(units > 0) || steps.length === 0) return 0;
    let remaining = units;
    let charge = 0;
    for (let index = 0; index < steps.length && remaining > 0; index++) {
        const {from, to} = blockBounds(steps, index);
        const inThisBlock = Math.min(remaining, to - from);
        if (inThisBlock <= 0) continue;
        charge += inThisBlock * steps[index].rate;
        remaining -= inThisBlock;
    }
    return charge;
}

/** Index of the block the NEXT unit falls in — the rate a saved unit is worth. */
function activeBlockIndex(
    units: number,
    steps: readonly TariffBlockStepSpec[]
): number {
    const used = Math.max(0, units);
    for (let index = 0; index < steps.length; index++) {
        if (used < blockBounds(steps, index).to) return index;
    }
    return steps.length - 1;
}

/**
 * What one more unit costs, surcharge included, once `units` are already used
 * in this billing period. Also what one unit saved is worth.
 */
export function marginalUnitPrice(
    units: number,
    blocks: TariffBlockSpec
): number {
    if (blocks.steps.length === 0) return blocks.surcharge;
    return (
        blocks.steps[activeBlockIndex(units, blocks.steps)].rate +
        blocks.surcharge
    );
}

/** One interval bucket's consumption, in the tariff's billed unit. */
export interface BlockBucketUsage {
    /** Start of the interval bucket. */
    at: Date;
    /** ISO key the cost engine looks the price up by. */
    bucket: string;
    units: number;
}

export interface BlockPriceIndex {
    /** Blended per-unit price for the bucket, surcharge included. */
    priceAt(bucket: string): number | null;
}

/** The slice of a 15-minute cost row block accumulation needs. */
export interface BlockUsageRow {
    bucket: string;
    consumptionUnits: number;
}

/**
 * Collapse per-(device, channel) rows into one usage figure per bucket instant.
 * Blocks are a property of the metered total, so every point sharing an instant
 * must accumulate against the same running total — and every row at that
 * instant then pays the same blended rate.
 */
export function blockBucketsFromRows(
    rows: readonly BlockUsageRow[],
    eligible: (at: Date) => boolean = () => true
): BlockBucketUsage[] {
    const byBucket = new Map<string, BlockBucketUsage>();
    const rejected = new Set<string>();
    for (const row of rows) {
        if (rejected.has(row.bucket)) continue;
        let usage = byBucket.get(row.bucket);
        if (!usage) {
            const at = new Date(row.bucket);
            // A bucket outside the tariff's contract dates is billed by
            // nothing, so it must not eat block allowance either.
            if (!eligible(at)) {
                rejected.add(row.bucket);
                continue;
            }
            usage = {at, bucket: row.bucket, units: 0};
            byBucket.set(row.bucket, usage);
        }
        usage.units += row.consumptionUnits;
    }
    return [...byBucket.values()];
}

export interface BlockPriceIndexRequest {
    blocks: TariffBlockSpec;
    timezone: string;
    billingDay: number;
    /**
     * Every bucket the tariff prices, back to the opening anchor of each
     * billing period it touches. A range that starts mid-period must include
     * the period-to-date buckets before it or the blocks restart at zero and
     * the period is undercharged.
     */
    buckets: readonly BlockBucketUsage[];
}

/**
 * Per-bucket blended marginal price for a stepped tariff.
 *
 * The cost engine prices each 15-minute piece independently, so the block
 * position has to be resolved before it runs: buckets are grouped into billing
 * periods, walked oldest-first, and each one is charged the difference between
 * the stepped charge before and after it. Summing those differences over a
 * period reproduces `steppedCharge(period total)` exactly, so the report's
 * energy line and the block maths cannot drift apart.
 */
export function buildBlockPriceIndex(
    request: BlockPriceIndexRequest
): BlockPriceIndex {
    const {blocks, timezone, billingDay} = request;
    const byPeriod = new Map<number, BlockBucketUsage[]>();
    for (const bucket of request.buckets) {
        const period = billingPeriodIndexAt(bucket.at, timezone, billingDay);
        const list = byPeriod.get(period);
        if (list) list.push(bucket);
        else byPeriod.set(period, [bucket]);
    }

    const prices = new Map<string, number>();
    for (const buckets of byPeriod.values()) {
        let used = 0;
        for (const bucket of [...buckets].sort(
            (a, b) => a.at.getTime() - b.at.getTime()
        )) {
            // An empty bucket has nothing to spread a charge over; quote the
            // rate the next unit would pay so the price is never NaN.
            if (!(bucket.units > 0)) {
                prices.set(bucket.bucket, marginalUnitPrice(used, blocks));
                continue;
            }
            const charge =
                steppedCharge(used + bucket.units, blocks.steps) -
                steppedCharge(used, blocks.steps);
            prices.set(bucket.bucket, charge / bucket.units + blocks.surcharge);
            used += bucket.units;
        }
    }

    return {
        priceAt: (bucket) => prices.get(bucket) ?? null
    };
}
