import {roundCurrencyAmount} from '../../types/api/_currency.js';
import type {
    CarbonAccountingBasis,
    CarbonCalculateResponse,
    CarbonEmissionsScope,
    CarbonPriceSpec
} from '../../types/api/carbon.js';

export type CarbonFactorSource =
    | 'dashboard_override'
    | 'factor_store'
    | 'deployment_default';

export interface ResolvedEmissionFactor {
    id: number | null;
    factorKgPerUnit: number;
    source: CarbonFactorSource;
    sourceReference: string;
    revision: number | null;
    accountingBasis: CarbonAccountingBasis;
    emissionsScope: CarbonEmissionsScope;
}

export interface CarbonAccountingInput {
    quantity: number;
    factor: ResolvedEmissionFactor;
    price?: Required<CarbonPriceSpec> | null;
    priceRequested?: boolean;
}

function roundKg(value: number): number {
    return +value.toFixed(6);
}

export function computeCarbonAccounting(
    input: CarbonAccountingInput
): CarbonCalculateResponse {
    const quantity = finiteNonNegative(input.quantity);
    const factorKgPerUnit = finiteNonNegative(input.factor.factorKgPerUnit);
    const projectImpactKgCO2e = roundKg(quantity * factorKgPerUnit);
    const scope2KgCO2e =
        input.factor.emissionsScope === 'scope2' ? projectImpactKgCO2e : null;
    const price = input.price ?? null;
    const priceApplies =
        price !== null &&
        (price.appliesToScope === input.factor.emissionsScope ||
            price.appliesToScope === 'all');
    const carbonValue = priceApplies
        ? {
              amount: roundCurrencyAmount(
                  (projectImpactKgCO2e / 1000) * price.amountPerTonne,
                  price.currency
              ),
              currency: price.currency,
              priceId: price.id,
              priceType: price.priceType,
              amountPerTonne: price.amountPerTonne
          }
        : null;

    return {
        quantity,
        projectImpactKgCO2e,
        scope2KgCO2e,
        factor: {...input.factor, factorKgPerUnit},
        carbonPriceStatus: priceApplies
            ? 'resolved'
            : input.priceRequested
              ? 'unavailable_or_ambiguous'
              : 'not_requested',
        carbonValue
    };
}

function finiteNonNegative(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}
