// Per-cost-center cost allocation. A tenant meter is any logical meter with a
// cost_center label. The result is a row per cost center, plus an "Unallocated"
// row when a meter is missing a cost center.

export interface TenantUsage {
    readonly costCenter: string | null;
    readonly kWh: number;
    // The per-device cost from the cost pass — already correct for stored /
    // live / per-channel tariffs. Do not recompute from an inline rate.
    readonly cost: number;
}

export interface TenantBillingRow {
    readonly costCenter: string;
    readonly kWh: number;
    readonly cost: number;
    readonly sharePct: number;
}

export interface TenantBillingResult {
    readonly rows: readonly TenantBillingRow[];
    readonly totalKWh: number;
    readonly totalCost: number;
}

const UNALLOCATED_LABEL = 'Unallocated';

export function computeTenantBilling(
    usages: readonly TenantUsage[]
): TenantBillingResult {
    const grouped = groupByCostCenter(usages);
    return finalise(grouped);
}

function groupByCostCenter(
    usages: readonly TenantUsage[]
): Map<string, {kWh: number; cost: number}> {
    const out = new Map<string, {kWh: number; cost: number}>();
    for (const usage of usages) {
        if (!Number.isFinite(usage.kWh) || usage.kWh <= 0) continue;
        const label = usage.costCenter?.trim() || UNALLOCATED_LABEL;
        const entry = out.get(label) ?? {kWh: 0, cost: 0};
        const cost = Number.isFinite(usage.cost) ? usage.cost : 0;
        out.set(label, {kWh: entry.kWh + usage.kWh, cost: entry.cost + cost});
    }
    return out;
}

function finalise(
    grouped: ReadonlyMap<string, {kWh: number; cost: number}>
): TenantBillingResult {
    const totalKWh = sumKWh(grouped);
    const rows = [...grouped.entries()]
        .map(([costCenter, {kWh, cost}]) => ({
            costCenter,
            kWh: round3(kWh),
            cost: round2(cost),
            sharePct:
                totalKWh > 0 ? Math.round((kWh / totalKWh) * 1000) / 10 : 0
        }))
        .sort((a, b) => b.kWh - a.kWh);
    const totalCost = [...grouped.values()].reduce((a, b) => a + b.cost, 0);
    return {rows, totalKWh: round3(totalKWh), totalCost: round2(totalCost)};
}

function sumKWh(grouped: ReadonlyMap<string, {kWh: number}>): number {
    let total = 0;
    for (const entry of grouped.values()) total += entry.kWh;
    return total;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}
