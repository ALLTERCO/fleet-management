import RpcError from '../../rpc/RpcError';
import type {TariffPriceComponentSpec} from '../../types/api/tariff';
import {dateInZone} from './localTimeInZone';

export interface TariffComponentLine {
    code: string;
    name: string;
    sequence: number;
    chargeClass: string;
    basis: TariffPriceComponentSpec['basis'];
    amount: number;
    taxable: boolean;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    sourceReference: string | null;
}

export interface TariffComponentCalculation {
    lines: TariffComponentLine[];
    subtotals: Record<string, number>;
    total: number;
}

export interface TariffComponentCalculationRequest {
    components: readonly TariffPriceComponentSpec[];
    consumptionUnits: number;
    periodDays: number;
    billingMonths: number;
    energy: number;
    demand: number;
    standing: number;
    from: Date;
    to: Date;
    fractionDigits: number;
    timezone: string;
}

/** Evaluate ordered named lines. Legacy lines seed the basis/reference map but
 * are not returned, so an omitted component catalogue changes no bill. */
export function calculateTariffComponents(
    request: TariffComponentCalculationRequest
): TariffComponentCalculation {
    const values = new Map<string, {amount: number; taxable: boolean}>([
        ['legacy_energy', {amount: request.energy, taxable: true}],
        ['legacy_demand', {amount: request.demand, taxable: true}],
        ['legacy_standing', {amount: request.standing, taxable: true}]
    ]);
    const lines: TariffComponentLine[] = [];
    const seenCodes = new Set(values.keys());
    const seenSequences = new Set<number>();
    for (const component of [...request.components].sort(
        (left, right) => left.sequence - right.sequence
    )) {
        assertComponentOrder(component, seenCodes, seenSequences);
        assertBasis(component);
        seenCodes.add(component.code);
        seenSequences.add(component.sequence);
        if (
            !componentApplies(
                component,
                request.from,
                request.to,
                request.timezone
            )
        )
            continue;
        const references = component.appliesTo ?? [];
        if (
            component.chargeClass === 'tax' &&
            references.some((code) => values.get(code)?.taxable === false)
        ) {
            throw invalid(
                `Tax component '${component.code}' includes a line marked non-taxable.`
            );
        }
        const referencedSubtotal = round(
            references.reduce(
                (sum, code) => sum + (values.get(code)?.amount ?? 0),
                0
            ),
            request.fractionDigits
        );
        let amount: number;
        switch (component.chargeType) {
            case 'per_unit':
                amount = request.consumptionUnits * component.rate;
                break;
            case 'fixed_day':
                amount = request.periodDays * component.rate;
                break;
            case 'fixed_month':
                amount = request.billingMonths * component.rate;
                break;
            case 'percentage':
                amount = referencedSubtotal * (component.rate / 100);
                break;
            case 'minimum':
                amount = Math.max(0, component.rate - referencedSubtotal);
                break;
        }
        amount = round(amount, request.fractionDigits);
        values.set(component.code, {
            amount,
            taxable: component.taxable ?? true
        });
        lines.push({
            code: component.code,
            name: component.name,
            sequence: component.sequence,
            chargeClass: component.chargeClass,
            basis: component.basis,
            amount,
            taxable: component.taxable ?? true,
            effectiveFrom: component.effectiveFrom ?? null,
            effectiveTo: component.effectiveTo ?? null,
            sourceReference: component.sourceReference ?? null
        });
    }
    const subtotals: Record<string, number> = {};
    for (const line of lines) {
        subtotals[line.chargeClass] = round(
            (subtotals[line.chargeClass] ?? 0) + line.amount,
            request.fractionDigits
        );
    }
    return {
        lines,
        subtotals,
        total: round(
            lines.reduce((sum, line) => sum + line.amount, 0),
            request.fractionDigits
        )
    };
}

function assertComponentOrder(
    component: TariffPriceComponentSpec,
    priorCodes: ReadonlySet<string>,
    sequences: ReadonlySet<number>
): void {
    if (sequences.has(component.sequence)) {
        throw invalid(`Duplicate component sequence ${component.sequence}.`);
    }
    for (const code of component.appliesTo ?? []) {
        if (!priorCodes.has(code)) {
            throw invalid(
                `Component '${component.code}' references '${code}', which is not an earlier bill line.`
            );
        }
    }
}

function componentApplies(
    component: TariffPriceComponentSpec,
    from: Date,
    to: Date,
    timezone: string
): boolean {
    const localFrom = dateKey(from, timezone);
    const localTo = dateKey(new Date(to.getTime() - 1), timezone);
    if (component.effectiveTo && component.effectiveTo <= localFrom)
        return false;
    if (component.effectiveFrom && component.effectiveFrom > localTo)
        return false;
    if (
        (component.effectiveFrom && component.effectiveFrom > localFrom) ||
        (component.effectiveTo && component.effectiveTo <= localTo)
    ) {
        throw invalid(
            `Component '${component.code}' changes inside the requested bill period; split the bill at its effective date.`
        );
    }
    return true;
}

function dateKey(at: Date, timezone: string): string {
    const local = dateInZone(at, timezone);
    return `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

function assertBasis(component: TariffPriceComponentSpec): void {
    const expected: Record<
        TariffPriceComponentSpec['chargeType'],
        TariffPriceComponentSpec['basis']
    > = {
        per_unit: 'consumption',
        fixed_day: 'standing',
        fixed_month: 'standing',
        percentage: 'subtotal',
        minimum: 'subtotal'
    };
    if (component.basis !== expected[component.chargeType]) {
        throw invalid(
            `Component '${component.code}' with type '${component.chargeType}' must use basis '${expected[component.chargeType]}'.`
        );
    }
}

function round(value: number, digits: number): number {
    return +value.toFixed(digits);
}

function invalid(message: string): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message,
        field: 'tariff.components'
    });
}
