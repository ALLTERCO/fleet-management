// Prices 15-minute energy pieces and sums them — so day/night cost is correct
// even when the report is viewed at a coarse (daily) granularity.

import type {TariffBand} from '../../types/api/tariff';

export interface Energy15minCostRow {
    device: number;
    channel: number;
    bucket: string; // ISO timestamp of the 15-min bucket
    /** Consumption already converted to the tariff's billed unit. */
    consumptionUnits: number;
    /** Returned quantity in the same billed unit; zero when unsupported. */
    returnedUnits: number;
}

export interface BucketPricing {
    price: number; // per kWh; may be negative on live tariffs
    isDay: boolean; // day/peak vs night/off-peak
    /** Named time-of-use band. Null or absent when the tariff has no clock
     * structure to name — block and live price on usage and feed, not hours. */
    band?: TariffBand | null;
    estimated?: boolean; // price filled from a feed gap (VEE), not a real read
}

export type CostPriceResolver = (row: Energy15minCostRow) => BucketPricing;

export interface ScopeCost {
    consumptionKWh: number;
    returnedKWh: number;
    cost: number;
}

export interface EnergyCostResult {
    totals: ScopeCost & {
        dayConsumptionKWh: number;
        nightConsumptionKWh: number;
        dayCost: number;
        nightCost: number;
    };
    perDevice: Map<number, ScopeCost>;
    perDisplayBucket: Map<string, ScopeCost>;
    /** Only bands that actually priced something. A two-band network has two
     * entries; it never carries a shoulder of zero, which would read as
     * "measured and found nothing". */
    perBand: Map<TariffBand, ScopeCost>;
    estimatedKWh: number; // consumption priced from an estimated tariff (gap fill)
}

function zeroCost(): ScopeCost {
    return {consumptionKWh: 0, returnedKWh: 0, cost: 0};
}

function addToCost(
    acc: ScopeCost,
    consKWh: number,
    retKWh: number,
    cost: number
): void {
    acc.consumptionKWh += consKWh;
    acc.returnedKWh += retKWh;
    acc.cost += cost;
}

// displayBucketKeyOf maps a row to the coarser display bucket (and device) the
// row's cost belongs to; rows sharing a key are summed.
export function computeEnergyCost(
    rows: readonly Energy15minCostRow[],
    resolvePrice: CostPriceResolver,
    displayBucketKeyOf: (row: Energy15minCostRow) => string
): EnergyCostResult {
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
    const perDisplayBucket = new Map<string, ScopeCost>();
    const perBand = new Map<TariffBand, ScopeCost>();
    let estimatedKWh = 0;

    for (const row of rows) {
        const consKWh = row.consumptionUnits;
        const retKWh = row.returnedUnits;
        const pricing = resolvePrice(row);
        if (pricing.estimated) estimatedKWh += consKWh;
        // Cost is on consumption only — returned energy is handled separately.
        const cost = consKWh * pricing.price;

        totals.consumptionKWh += consKWh;
        totals.returnedKWh += retKWh;
        totals.cost += cost;
        if (pricing.isDay) {
            totals.dayConsumptionKWh += consKWh;
            totals.dayCost += cost;
        } else {
            totals.nightConsumptionKWh += consKWh;
            totals.nightCost += cost;
        }

        if (pricing.band) {
            if (!perBand.has(pricing.band)) {
                perBand.set(pricing.band, zeroCost());
            }
            addToCost(perBand.get(pricing.band)!, consKWh, retKWh, cost);
        }

        if (!perDevice.has(row.device)) perDevice.set(row.device, zeroCost());
        addToCost(perDevice.get(row.device)!, consKWh, retKWh, cost);

        const key = displayBucketKeyOf(row);
        if (!perDisplayBucket.has(key)) perDisplayBucket.set(key, zeroCost());
        addToCost(perDisplayBucket.get(key)!, consKWh, retKWh, cost);
    }

    return {totals, perDevice, perDisplayBucket, perBand, estimatedKWh};
}
