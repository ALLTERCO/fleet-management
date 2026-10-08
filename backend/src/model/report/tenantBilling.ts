// Per-cost-center chargeback. Measured energy cost remains canonical; shared
// bill lines are allocated transparently and reconciled in currency minor units.

import type {TariffTaxSpec} from '../../types/api/tariff';
import type {
    TariffDemandDeviceSample,
    TariffDemandPeriodCharge
} from './tariffDemandCharges';
import {calculateTariffTaxes} from './tariffTaxes';

export interface TenantUsage {
    readonly costCenter: string | null;
    /** Imported energy. Zero and negative rows remain visible. */
    readonly kWh: number;
    /** Canonical energy cost from the report cost pass. */
    readonly cost: number;
}

export type TenantDemandAllocationMethod =
    | 'coincident_master_peak'
    | 'imported_kwh_proxy'
    | 'mixed_coincident_and_kwh_proxy'
    | 'not_applicable';

export interface TenantDemandAllocation {
    readonly weights: ReadonlyMap<string, number>;
    readonly method: Exclude<TenantDemandAllocationMethod, 'not_applicable'>;
}

export interface TenantTaxAllocation {
    readonly code: string;
    readonly name: string;
    readonly ratePct: number;
    readonly calculation: 'exclusive' | 'inclusive';
    readonly exempt: boolean;
    readonly amount: number;
}

export interface TenantBillingRow {
    readonly costCenter: string;
    readonly kWh: number;
    /** Full tenant total, retained under the old field name for report callers. */
    readonly cost: number;
    readonly energyCost: number;
    readonly demandCharge: number;
    readonly standingCharge: number;
    readonly taxes: readonly TenantTaxAllocation[];
    readonly sharePct: number;
}

export interface TenantBillingResult {
    readonly rows: readonly TenantBillingRow[];
    readonly totalKWh: number;
    readonly totalCost: number;
    readonly demandAllocationMethod: TenantDemandAllocationMethod;
}

export interface TenantBillingInput {
    readonly usages: readonly TenantUsage[];
    /** Master energy line. Any gap from tenant meters is shown as Unallocated. */
    readonly masterEnergyCost?: number;
    readonly demandCharge?: number;
    readonly standingCharge?: number;
    readonly taxes?: readonly TariffTaxSpec[];
    readonly currencyFractionDigits?: number;
    readonly demandAllocation?: TenantDemandAllocation | null;
}

interface GroupedTenant {
    kWh: number;
    energyMinor: number;
}

export interface TenantDemandWeightsInput {
    readonly periods: readonly TariffDemandPeriodCharge[];
    readonly samples: readonly TariffDemandDeviceSample[];
    readonly tenantCostCenters: ReadonlyMap<number, string>;
    readonly importedKWhByCostCenter: ReadonlyMap<string, number>;
}

const UNALLOCATED_LABEL = 'Unallocated';

export function computeTenantBilling(
    input: TenantBillingInput
): TenantBillingResult {
    const fractionDigits = input.currencyFractionDigits ?? 2;
    const scale = currencyScale(fractionDigits);
    const grouped = groupByCostCenter(input.usages, scale);
    reconcileEnergyToMaster(grouped, input.masterEnergyCost, scale);

    const demandMinor = toMinorUnits(input.demandCharge ?? 0, scale);
    const standingMinor = toMinorUnits(input.standingCharge ?? 0, scale);
    ensureAllocationTarget(grouped, demandMinor + standingMinor);
    const labels = sortedLabels(grouped);
    const importedWeights = importedKWhWeights(grouped);
    const standingByLabel = allocateMinorUnits(
        standingMinor,
        labels,
        importedWeights,
        UNALLOCATED_LABEL
    );
    const effectiveDemand = resolveDemandAllocation(
        input.demandAllocation,
        labels,
        importedWeights
    );
    const demandByLabel = allocateMinorUnits(
        demandMinor,
        labels,
        effectiveDemand.weights,
        UNALLOCATED_LABEL
    );
    const chargesByLabel = new Map(
        labels.map((label) => {
            const tenant = grouped.get(label)!;
            return [
                label,
                {
                    energy: tenant.energyMinor / scale,
                    demand: (demandByLabel.get(label) ?? 0) / scale,
                    standing: (standingByLabel.get(label) ?? 0) / scale
                }
            ] as const;
        })
    );
    const taxByLabel = allocateTaxes({
        labels,
        chargesByLabel,
        masterCharges: {
            energy: masterEnergyMinor(grouped) / scale,
            demand: demandMinor / scale,
            standing: standingMinor / scale
        },
        taxes: input.taxes ?? [],
        fractionDigits,
        fallbackWeights: importedWeights
    });
    const shareTenths = allocateShareTenths(labels, importedWeights);
    const rows = labels
        .map((costCenter) => {
            const tenant = grouped.get(costCenter)!;
            const charges = chargesByLabel.get(costCenter)!;
            const taxes = taxByLabel.get(costCenter) ?? [];
            const exclusiveTax = taxes
                .filter((tax) => tax.calculation === 'exclusive')
                .reduce((sum, tax) => sum + tax.amount, 0);
            return {
                costCenter,
                kWh: round3(tenant.kWh),
                cost: roundCurrency(
                    charges.energy +
                        charges.demand +
                        charges.standing +
                        exclusiveTax,
                    fractionDigits
                ),
                energyCost: charges.energy,
                demandCharge: charges.demand,
                standingCharge: charges.standing,
                taxes,
                sharePct: (shareTenths.get(costCenter) ?? 0) / 10
            };
        })
        .sort(
            (a, b) => b.kWh - a.kWh || a.costCenter.localeCompare(b.costCenter)
        );
    return {
        rows,
        totalKWh: round3(
            [...grouped.values()].reduce((sum, tenant) => sum + tenant.kWh, 0)
        ),
        totalCost: roundCurrency(
            rows.reduce((sum, row) => sum + row.cost, 0),
            fractionDigits
        ),
        demandAllocationMethod:
            demandMinor === 0 ? 'not_applicable' : effectiveDemand.method
    };
}

/**
 * Weigh each demand period by tenant contribution at the billed master peak.
 * A period falls back to imported-kWh share unless every tenant meter has a
 * stored sample at that instant. The returned method makes any proxy explicit.
 */
export function buildTenantDemandAllocation(
    input: TenantDemandWeightsInput
): TenantDemandAllocation | null {
    if (input.periods.length === 0 || input.tenantCostCenters.size === 0) {
        return null;
    }
    const samplesByInstant = demandSamplesByInstant(input.samples);
    const weighted = new Map<string, number>();
    let coincidentPeriods = 0;
    let proxyPeriods = 0;
    for (const period of input.periods) {
        if (period.charge === 0) continue;
        const coincident = coincidentWeights(
            period.peakAt,
            samplesByInstant,
            input.tenantCostCenters
        );
        const usable = coincident !== null && sumWeights(coincident) > 0;
        const periodWeights = usable
            ? coincident
            : input.importedKWhByCostCenter;
        if (usable) coincidentPeriods += 1;
        else proxyPeriods += 1;
        addNormalisedPeriodWeights(weighted, periodWeights, period.charge);
    }
    if (sumWeights(weighted) <= 0) return null;
    return {
        weights: weighted,
        method:
            coincidentPeriods > 0 && proxyPeriods > 0
                ? 'mixed_coincident_and_kwh_proxy'
                : coincidentPeriods > 0
                  ? 'coincident_master_peak'
                  : 'imported_kwh_proxy'
    };
}

function groupByCostCenter(
    usages: readonly TenantUsage[],
    scale: number
): Map<string, GroupedTenant> {
    const grouped = new Map<string, GroupedTenant>();
    for (const usage of usages) {
        assertFiniteUsage(usage);
        const label = tenantCostCenterLabel(usage.costCenter);
        const current = grouped.get(label) ?? {kWh: 0, energyMinor: 0};
        current.kWh += usage.kWh;
        current.energyMinor += toMinorUnits(usage.cost, scale);
        grouped.set(label, current);
    }
    return grouped;
}

function assertFiniteUsage(usage: TenantUsage): void {
    if (!Number.isFinite(usage.kWh) || !Number.isFinite(usage.cost)) {
        throw new RangeError('Tenant usage kWh and cost must be finite');
    }
}

export function tenantCostCenterLabel(costCenter: string | null): string {
    return costCenter?.trim() || UNALLOCATED_LABEL;
}

function reconcileEnergyToMaster(
    grouped: Map<string, GroupedTenant>,
    masterEnergyCost: number | undefined,
    scale: number
): void {
    if (masterEnergyCost === undefined) return;
    if (!Number.isFinite(masterEnergyCost)) {
        throw new RangeError('Master energy cost must be finite');
    }
    const target = toMinorUnits(masterEnergyCost, scale);
    const residual = target - masterEnergyMinor(grouped);
    if (residual === 0) return;
    const unallocated = grouped.get(UNALLOCATED_LABEL) ?? {
        kWh: 0,
        energyMinor: 0
    };
    unallocated.energyMinor += residual;
    grouped.set(UNALLOCATED_LABEL, unallocated);
}

function masterEnergyMinor(
    grouped: ReadonlyMap<string, GroupedTenant>
): number {
    return [...grouped.values()].reduce(
        (sum, tenant) => sum + tenant.energyMinor,
        0
    );
}

function ensureAllocationTarget(
    grouped: Map<string, GroupedTenant>,
    sharedMinor: number
): void {
    if (grouped.size > 0 && (sharedMinor === 0 || hasPositiveImport(grouped))) {
        return;
    }
    if (!grouped.has(UNALLOCATED_LABEL)) {
        grouped.set(UNALLOCATED_LABEL, {kWh: 0, energyMinor: 0});
    }
}

function hasPositiveImport(
    grouped: ReadonlyMap<string, GroupedTenant>
): boolean {
    return [...grouped.values()].some((tenant) => tenant.kWh > 0);
}

function sortedLabels(grouped: ReadonlyMap<string, GroupedTenant>): string[] {
    return [...grouped.keys()].sort((a, b) => a.localeCompare(b));
}

function importedKWhWeights(
    grouped: ReadonlyMap<string, GroupedTenant>
): ReadonlyMap<string, number> {
    return new Map(
        [...grouped].map(([label, tenant]) => [label, Math.max(0, tenant.kWh)])
    );
}

function resolveDemandAllocation(
    allocation: TenantDemandAllocation | null | undefined,
    labels: readonly string[],
    importedWeights: ReadonlyMap<string, number>
): TenantDemandAllocation {
    if (
        allocation &&
        labels.some((label) => (allocation.weights.get(label) ?? 0) > 0)
    ) {
        return allocation;
    }
    return {weights: importedWeights, method: 'imported_kwh_proxy'};
}

function allocateMinorUnits(
    totalMinor: number,
    labels: readonly string[],
    weights: ReadonlyMap<string, number>,
    fallbackLabel: string
): Map<string, number> {
    const output = new Map(labels.map((label) => [label, 0]));
    if (totalMinor === 0 || labels.length === 0) return output;
    const positive = labels.map((label, index) => ({
        label,
        index,
        weight: Math.max(0, finiteWeight(weights.get(label)))
    }));
    const totalWeight = positive.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
        output.set(
            output.has(fallbackLabel) ? fallbackLabel : labels[0],
            totalMinor
        );
        return output;
    }
    const sign = totalMinor < 0 ? -1 : 1;
    const magnitude = Math.abs(totalMinor);
    const shares = positive.map((item) => {
        const exact = (magnitude * item.weight) / totalWeight;
        const floor = Math.floor(exact);
        return {...item, minor: floor, remainder: exact - floor};
    });
    let remaining =
        magnitude - shares.reduce((sum, item) => sum + item.minor, 0);
    shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (const share of shares) {
        if (remaining <= 0) break;
        share.minor += 1;
        remaining -= 1;
    }
    for (const share of shares) {
        output.set(share.label, sign * share.minor);
    }
    return output;
}

function allocateShareTenths(
    labels: readonly string[],
    weights: ReadonlyMap<string, number>
): Map<string, number> {
    return allocateMinorUnits(1_000, labels, weights, UNALLOCATED_LABEL);
}

function finiteWeight(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) ? value : 0;
}

interface TaxAllocationInput {
    labels: readonly string[];
    chargesByLabel: ReadonlyMap<
        string,
        {energy: number; demand: number; standing: number}
    >;
    masterCharges: {energy: number; demand: number; standing: number};
    taxes: readonly TariffTaxSpec[];
    fractionDigits: number;
    fallbackWeights: ReadonlyMap<string, number>;
}

function allocateTaxes(
    input: TaxAllocationInput
): Map<string, TenantTaxAllocation[]> {
    const output = new Map(
        input.labels.map((label) => [label, [] as TenantTaxAllocation[]])
    );
    if (input.taxes.length === 0) return output;
    const scale = currencyScale(input.fractionDigits);
    const master = calculateTariffTaxes(
        input.taxes,
        input.masterCharges,
        input.fractionDigits
    );
    const local = new Map(
        input.labels.map((label) => [
            label,
            calculateTariffTaxes(
                input.taxes,
                input.chargesByLabel.get(label)!,
                input.fractionDigits
            )
        ])
    );
    for (let index = 0; index < input.taxes.length; index += 1) {
        const tax = input.taxes[index];
        const targetMinor = toMinorUnits(master.items[index].amount, scale);
        const idealWeights = new Map(
            input.labels.map((label) => [
                label,
                Math.abs(local.get(label)!.items[index].amount)
            ])
        );
        const weights =
            sumWeights(idealWeights) > 0 ? idealWeights : input.fallbackWeights;
        const amounts = allocateMinorUnits(
            targetMinor,
            input.labels,
            weights,
            UNALLOCATED_LABEL
        );
        for (const label of input.labels) {
            output.get(label)!.push({
                code: tax.code,
                name: tax.name,
                ratePct: tax.ratePct,
                calculation: tax.calculation,
                exempt: tax.exempt === true,
                amount: (amounts.get(label) ?? 0) / scale
            });
        }
    }
    return output;
}

function demandSamplesByInstant(
    samples: readonly TariffDemandDeviceSample[]
): ReadonlyMap<string, ReadonlyMap<number, number>> {
    const output = new Map<string, Map<number, number>>();
    for (const sample of samples) {
        const key = sample.at.toISOString();
        const byDevice = output.get(key) ?? new Map<number, number>();
        byDevice.set(sample.deviceId, sample.value);
        output.set(key, byDevice);
    }
    return output;
}

function coincidentWeights(
    peakAt: Date | null,
    samplesByInstant: ReadonlyMap<string, ReadonlyMap<number, number>>,
    tenantCostCenters: ReadonlyMap<number, string>
): ReadonlyMap<string, number> | null {
    if (!peakAt) return null;
    const samples = samplesByInstant.get(peakAt.toISOString());
    if (!samples) return null;
    const output = new Map<string, number>();
    for (const [deviceId, costCenter] of tenantCostCenters) {
        const value = samples.get(deviceId);
        if (value === undefined || !Number.isFinite(value)) return null;
        output.set(
            costCenter,
            (output.get(costCenter) ?? 0) + Math.max(0, value)
        );
    }
    return output;
}

function addNormalisedPeriodWeights(
    target: Map<string, number>,
    weights: ReadonlyMap<string, number>,
    periodCharge: number
): void {
    const total = sumWeights(weights);
    if (total <= 0) return;
    for (const [label, rawWeight] of weights) {
        const weight = Math.max(0, finiteWeight(rawWeight));
        target.set(
            label,
            (target.get(label) ?? 0) + (periodCharge * weight) / total
        );
    }
}

function sumWeights(weights: ReadonlyMap<string, number>): number {
    return [...weights.values()].reduce(
        (sum, value) => sum + Math.max(0, finiteWeight(value)),
        0
    );
}

function currencyScale(fractionDigits: number): number {
    if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
        throw new RangeError(
            'Currency fraction digits must be a non-negative integer'
        );
    }
    return 10 ** fractionDigits;
}

function toMinorUnits(value: number, scale: number): number {
    if (!Number.isFinite(value)) {
        throw new RangeError('Money value must be finite');
    }
    return Math.round(value * scale);
}

function roundCurrency(value: number, fractionDigits: number): number {
    return +value.toFixed(fractionDigits);
}

function round3(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}
