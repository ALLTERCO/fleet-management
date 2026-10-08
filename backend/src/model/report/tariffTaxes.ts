import type {
    TariffSpec,
    TariffTaxBasis,
    TariffTaxSpec
} from '../../types/api/tariff';

export type TariffTaxChargeAmounts = Readonly<Record<TariffTaxBasis, number>>;

export interface TariffTaxAmount {
    code: string;
    name: string;
    ratePct: number;
    calculation: 'exclusive' | 'inclusive';
    exempt: boolean;
    base: number;
    amount: number;
}

export interface TariffTaxCalculationResult {
    items: TariffTaxAmount[];
    /** Tax already contained in the configured charge amounts. */
    inclusiveTotal: number;
    /** Tax added after the charge subtotal. */
    exclusiveTotal: number;
}

function currencyScale(fractionDigits: number): number {
    return 10 ** fractionDigits;
}

function toMinorUnits(value: number, fractionDigits: number): number {
    return Math.round(value * currencyScale(fractionDigits));
}

function fromMinorUnits(value: number, fractionDigits: number): number {
    return value / currencyScale(fractionDigits);
}

interface InclusiveAllocation {
    baseMinor: number;
    amountMinor: number;
}

const TAX_BASES: readonly TariffTaxBasis[] = ['energy', 'demand', 'standing'];

/**
 * Allocate the included portion of each gross charge in integer minor units.
 * Largest-remainder allocation makes the named lines add exactly to the
 * rounded included total; rule order is the deterministic tie-breaker.
 */
function allocateInclusiveTaxes(
    taxes: readonly TariffTaxSpec[],
    charges: TariffTaxChargeAmounts,
    fractionDigits: number
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
        if (applicable.length === 0) continue;

        const active = applicable.filter(({tax}) => tax.ratePct > 0);
        const grossMinor = toMinorUnits(charges[basis], fractionDigits);
        const sign = grossMinor < 0 ? -1 : 1;
        const grossMagnitude = Math.abs(grossMinor);
        const rateTotal = active.reduce((sum, {tax}) => sum + tax.ratePct, 0);
        const includedMagnitude =
            rateTotal === 0
                ? 0
                : Math.round((grossMagnitude * rateTotal) / (100 + rateTotal));
        const includedMinor = sign * includedMagnitude;
        const netMinor = grossMinor - includedMinor;
        for (const {tax} of applicable) {
            allocated.get(tax.code)!.baseMinor += netMinor;
        }
        if (includedMagnitude === 0 || active.length === 0) continue;

        const shares = active.map(({tax, index}) => {
            const exact = (includedMagnitude * tax.ratePct) / rateTotal;
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

/**
 * Converts the old one-rate contract only when no explicit taxes value was
 * stored. This keeps every existing tariff's bill stable while allowing an
 * explicit [] to mean "no tax".
 */
export function effectiveTariffTaxes(
    tariff: Pick<TariffSpec, 'taxes' | 'vatPct'>
): TariffTaxSpec[] {
    if (tariff.taxes != null) return tariff.taxes;
    const ratePct = tariff.vatPct ?? 0;
    if (ratePct <= 0) return [];
    return [
        {
            code: 'vat',
            name: 'VAT',
            ratePct,
            calculation: 'exclusive',
            appliesTo: ['energy', 'demand', 'standing'],
            exempt: false,
            compoundOn: []
        }
    ];
}

/**
 * Evaluates percentage taxes in their stored order. Each money value is
 * rounded to the currency's minor unit before a later compound rule consumes
 * it, matching the amount a utility prints on the preceding line. compoundOn
 * adds only those earlier tax amounts, never their underlying charge bases.
 *
 * Exclusive tax is `base * rate / 100` and increases the bill total.
 * For every charge basis, all active inclusive rates share one denominator:
 * `net = gross / (1 + sum(rates))`. Their minor-unit allocations reconcile
 * exactly to gross - net and are reported but never added again.
 */
export function calculateTariffTaxes(
    taxes: readonly TariffTaxSpec[],
    charges: TariffTaxChargeAmounts,
    fractionDigits = 2
): TariffTaxCalculationResult {
    const inclusive = allocateInclusiveTaxes(taxes, charges, fractionDigits);
    const amountByCode = new Map<string, number>();
    const items: TariffTaxAmount[] = [];
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
            const chargeBaseMinor = tax.appliesTo.reduce(
                (sum, basis) =>
                    sum + toMinorUnits(charges[basis], fractionDigits),
                0
            );
            const compoundBaseMinor = (tax.compoundOn ?? []).reduce(
                (sum, code) =>
                    sum +
                    toMinorUnits(amountByCode.get(code) ?? 0, fractionDigits),
                0
            );
            baseMinor = chargeBaseMinor + compoundBaseMinor;
            amountMinor = exempt
                ? 0
                : Math.round((baseMinor * tax.ratePct) / 100);
        }
        const base = fromMinorUnits(baseMinor, fractionDigits);
        const amount = fromMinorUnits(amountMinor, fractionDigits);
        amountByCode.set(tax.code, amount);
        items.push({
            code: tax.code,
            name: tax.name,
            ratePct: tax.ratePct,
            calculation: tax.calculation,
            exempt,
            base,
            amount
        });
    }

    return {
        items,
        inclusiveTotal: fromMinorUnits(
            items
                .filter((item) => item.calculation === 'inclusive')
                .reduce(
                    (sum, item) =>
                        sum + toMinorUnits(item.amount, fractionDigits),
                    0
                ),
            fractionDigits
        ),
        exclusiveTotal: fromMinorUnits(
            items
                .filter((item) => item.calculation === 'exclusive')
                .reduce(
                    (sum, item) =>
                        sum + toMinorUnits(item.amount, fractionDigits),
                    0
                ),
            fractionDigits
        )
    };
}
