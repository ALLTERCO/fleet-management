// Prices 15-minute energy pieces and sums them — so day/night cost is correct
// even when the report is viewed at a coarse (daily) granularity.

export interface Energy15minCostRow {
    device: number;
    channel: number;
    bucket: string; // ISO timestamp of the 15-min bucket
    consumptionWh: number;
    returnedWh: number;
}

export interface BucketPricing {
    price: number; // per kWh; may be negative on live tariffs
    isDay: boolean; // day/peak vs night/off-peak
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
    let estimatedKWh = 0;

    for (const row of rows) {
        const consKWh = row.consumptionWh / 1000;
        const retKWh = row.returnedWh / 1000;
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

        if (!perDevice.has(row.device)) perDevice.set(row.device, zeroCost());
        addToCost(perDevice.get(row.device)!, consKWh, retKWh, cost);

        const key = displayBucketKeyOf(row);
        if (!perDisplayBucket.has(key)) perDisplayBucket.set(key, zeroCost());
        addToCost(perDisplayBucket.get(key)!, consKWh, retKWh, cost);
    }

    return {totals, perDevice, perDisplayBucket, estimatedKWh};
}
