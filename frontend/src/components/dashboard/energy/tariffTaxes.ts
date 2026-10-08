import {currencyFractionDigits} from '@api/_currency';
import type {TariffSpec, TariffTaxBasis, TariffTaxSpec} from '@api/tariff';

export type TariffTaxChargeAmounts = Readonly<Record<TariffTaxBasis, number>>;

export interface DashboardTaxAmount {
    code: string;
    name: string;
    ratePct: number;
    calculation: 'exclusive' | 'inclusive';
    exempt: boolean;
    base: number;
    amount: number;
}

const TAX_BASES: readonly TariffTaxBasis[] = ['energy', 'demand', 'standing'];

const scale = (digits: number) => 10 ** digits;
const toMinor = (value: number, digits: number) =>
    Math.round(value * scale(digits));
const fromMinor = (value: number, digits: number) => value / scale(digits);

interface InclusiveAllocation {
    baseMinor: number;
    amountMinor: number;
}

/** Exact mirror of report/tariffTaxes' integer-minor-unit, largest-remainder
 * allocation. Rule order is the deterministic tie-breaker. */
function allocateInclusiveTaxes(
    taxes: readonly TariffTaxSpec[],
    charges: TariffTaxChargeAmounts,
    digits: number
): Map<string, InclusiveAllocation> {
    const allocated = new Map<string, InclusiveAllocation>();
    for (const tax of taxes) {
        if (tax.calculation === 'inclusive') {
            allocated.set(tax.code, {baseMinor: 0, amountMinor: 0});
        }
    }
    for (const basis of TAX_BASES) {
        const applicable = taxes
            .map((tax, index) => ({tax, index}))
            .filter(
                ({tax}) =>
                    tax.calculation === 'inclusive' &&
                    !tax.exempt &&
                    tax.appliesTo.includes(basis)
            );
        if (!applicable.length) continue;
        const active = applicable.filter(({tax}) => tax.ratePct > 0);
        const grossMinor = toMinor(charges[basis], digits);
        const sign = grossMinor < 0 ? -1 : 1;
        const magnitude = Math.abs(grossMinor);
        const totalRate = active.reduce((sum, {tax}) => sum + tax.ratePct, 0);
        const includedMagnitude =
            totalRate === 0
                ? 0
                : Math.round((magnitude * totalRate) / (100 + totalRate));
        const netMinor = grossMinor - sign * includedMagnitude;
        for (const {tax} of applicable) {
            allocated.get(tax.code)!.baseMinor += netMinor;
        }
        if (includedMagnitude === 0 || !active.length) continue;
        const shares = active.map(({tax, index}) => {
            const exact = (includedMagnitude * tax.ratePct) / totalRate;
            const floor = Math.floor(exact);
            return {tax, index, minor: floor, remainder: exact - floor};
        });
        let remaining =
            includedMagnitude -
            shares.reduce((sum, share) => sum + share.minor, 0);
        shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
        for (const share of shares) {
            if (remaining <= 0) break;
            share.minor += 1;
            remaining -= 1;
        }
        for (const share of shares) {
            allocated.get(share.tax.code)!.amountMinor += sign * share.minor;
        }
    }
    return allocated;
}

/** Mirrors report/tariffTaxes: explicit [] means tax-free; only absent/null
 * structured rules promote the legacy VAT percentage. */
export function effectiveTariffTaxes(
    tariff: Pick<TariffSpec, 'taxes' | 'vatPct'>
): TariffTaxSpec[] {
    if (tariff.taxes != null) return tariff.taxes;
    const ratePct = tariff.vatPct ?? 0;
    return ratePct > 0
        ? [
              {
                  code: 'vat',
                  name: 'VAT',
                  ratePct,
                  calculation: 'exclusive',
                  appliesTo: ['energy', 'demand', 'standing'],
                  exempt: false,
                  compoundOn: []
              }
          ]
        : [];
}

/** Ordered percentage-tax evaluator shared by the dashboard bill mapper. */
export function calculateTariffTaxes(
    taxes: readonly TariffTaxSpec[],
    charges: TariffTaxChargeAmounts,
    currency?: string | null
): {
    items: DashboardTaxAmount[];
    inclusiveTotal: number;
    exclusiveTotal: number;
} {
    const digits = currencyFractionDigits(currency);
    const inclusive = allocateInclusiveTaxes(taxes, charges, digits);
    const amountByCode = new Map<string, number>();
    const items: DashboardTaxAmount[] = [];
    for (const tax of taxes) {
        const exempt = tax.exempt === true;
        let baseMinor: number;
        let amountMinor: number;
        if (tax.calculation === 'inclusive') {
            const allocation = inclusive.get(tax.code) ?? {
                baseMinor: 0,
                amountMinor: 0
            };
            baseMinor = allocation.baseMinor;
            amountMinor = allocation.amountMinor;
        } else {
            baseMinor = tax.appliesTo.reduce(
                (sum, basis) => sum + toMinor(charges[basis], digits),
                0
            );
            baseMinor += (tax.compoundOn ?? []).reduce(
                (sum, code) =>
                    sum + toMinor(amountByCode.get(code) ?? 0, digits),
                0
            );
            amountMinor = exempt
                ? 0
                : Math.round((baseMinor * tax.ratePct) / 100);
        }
        const base = fromMinor(baseMinor, digits);
        const amount = fromMinor(amountMinor, digits);
        amountByCode.set(tax.code, amount);
        items.push({...tax, exempt, base, amount});
    }
    return {
        items,
        inclusiveTotal: fromMinor(
            items
                .filter((item) => item.calculation === 'inclusive')
                .reduce((sum, item) => sum + toMinor(item.amount, digits), 0),
            digits
        ),
        exclusiveTotal: fromMinor(
            items
                .filter((item) => item.calculation === 'exclusive')
                .reduce((sum, item) => sum + toMinor(item.amount, digits), 0),
            digits
        )
    };
}
