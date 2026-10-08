import type {
    CarbonAccountingBasis,
    CarbonEmissionsScope,
    CarbonPriceSpec,
    CarbonPriceType,
    EmissionFactorSpec
} from '../../types/api/carbon.js';
import type {EnergyCommodity} from '../../types/api/energy.js';

export type CarbonDbCaller = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows: unknown[]} | null | undefined>;

export interface CarbonRepositoryDeps {
    callDb: CarbonDbCaller;
}

interface EmissionFactorRow {
    id: number | string;
    commodity: EnergyCommodity;
    billed_unit: string;
    region: string;
    accounting_basis: CarbonAccountingBasis;
    emissions_scope: CarbonEmissionsScope;
    factor_kg_per_unit: number | string;
    effective_from: string | Date;
    effective_to: string | Date | null;
    source_reference: string;
    revision: number;
}

interface CarbonPriceRow {
    id: number | string;
    name: string;
    price_type: CarbonPriceType;
    applies_to_scope: CarbonPriceSpec['appliesToScope'];
    currency: string;
    amount_per_tonne: number | string;
    effective_from: string | Date;
    effective_to: string | Date | null;
    source_reference: string;
    revision: number;
}

export interface EmissionFactorSelector {
    commodity: EnergyCommodity;
    billedUnit: string;
    region: string;
    accountingBasis: CarbonAccountingBasis;
    emissionsScope?: CarbonEmissionsScope;
    from: string;
    to: string;
}

export interface CarbonPriceSelector {
    scope: CarbonEmissionsScope;
    from: string;
    to: string;
    priceType?: CarbonPriceType;
}

export interface EmissionFactorOverlapSelector {
    commodity: EnergyCommodity;
    billedUnit: string;
    regions: readonly string[];
    accountingBasis: CarbonAccountingBasis;
    emissionsScope: CarbonEmissionsScope;
    from: string;
    to: string;
}

export interface CarbonListSelector {
    limit?: number;
    beforeId?: number;
}

export interface CarbonListPage<T> {
    items: T[];
    nextBeforeId: number | null;
}

const DEFAULT_LIST_LIMIT = 100;

function listLimit(selector: CarbonListSelector): number {
    const requested = selector.limit ?? DEFAULT_LIST_LIMIT;
    return Number.isInteger(requested) && requested > 0
        ? Math.min(requested, DEFAULT_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
}

function page<T extends {id: number}>(
    rows: T[],
    limit: number
): CarbonListPage<T> {
    const items = rows.slice(0, limit);
    return {
        items,
        nextBeforeId:
            rows.length > limit && items.length > 0
                ? items[items.length - 1]!.id
                : null
    };
}

function iso(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : value;
}

function mapFactor(row: EmissionFactorRow): Required<EmissionFactorSpec> {
    return {
        id: Number(row.id),
        commodity: row.commodity,
        billedUnit: row.billed_unit,
        region: row.region,
        accountingBasis: row.accounting_basis,
        emissionsScope: row.emissions_scope,
        factorKgPerUnit: Number(row.factor_kg_per_unit),
        effectiveFrom: iso(row.effective_from),
        effectiveTo: row.effective_to === null ? null : iso(row.effective_to),
        sourceReference: row.source_reference,
        revision: row.revision
    };
}

function mapPrice(row: CarbonPriceRow): Required<CarbonPriceSpec> {
    return {
        id: Number(row.id),
        name: row.name,
        priceType: row.price_type,
        appliesToScope: row.applies_to_scope,
        currency: row.currency,
        amountPerTonne: Number(row.amount_per_tonne),
        effectiveFrom: iso(row.effective_from),
        effectiveTo: row.effective_to === null ? null : iso(row.effective_to),
        sourceReference: row.source_reference,
        revision: row.revision
    };
}

export class CarbonRepository {
    readonly #deps: CarbonRepositoryDeps;

    constructor(deps: CarbonRepositoryDeps) {
        this.#deps = deps;
    }

    async listFactors(
        org: string,
        selector: CarbonListSelector = {}
    ): Promise<CarbonListPage<Required<EmissionFactorSpec>>> {
        const limit = listLimit(selector);
        const result = await this.#deps.callDb(
            'organization.fn_emission_factor_list',
            {
                p_org: org,
                p_limit: limit + 1,
                p_before_id: selector.beforeId ?? null
            }
        );
        return page(
            ((result?.rows ?? []) as EmissionFactorRow[]).map(mapFactor),
            limit
        );
    }

    async addFactor(
        org: string,
        spec: EmissionFactorSpec
    ): Promise<Required<EmissionFactorSpec>> {
        const result = await this.#deps.callDb(
            'organization.fn_emission_factor_add',
            {p_org: org, p_payload: spec}
        );
        const row = result?.rows[0] as EmissionFactorRow | undefined;
        if (!row) throw new Error('emission factor insert returned no row');
        return mapFactor(row);
    }

    async resolveFactor(
        org: string,
        selector: EmissionFactorSelector
    ): Promise<Required<EmissionFactorSpec> | null> {
        const result = await this.#deps.callDb(
            'organization.fn_emission_factor_resolve',
            {
                p_org: org,
                p_commodity: selector.commodity,
                p_billed_unit: selector.billedUnit,
                p_region: selector.region,
                p_accounting_basis: selector.accountingBasis,
                p_emissions_scope: selector.emissionsScope ?? null,
                p_from: selector.from,
                p_to: selector.to
            }
        );
        const row = result?.rows[0] as EmissionFactorRow | undefined;
        return row ? mapFactor(row) : null;
    }

    async listOverlappingFactors(
        org: string,
        selector: EmissionFactorOverlapSelector
    ): Promise<Required<EmissionFactorSpec>[]> {
        const result = await this.#deps.callDb(
            'organization.fn_emission_factor_list_overlapping',
            {
                p_org: org,
                p_commodity: selector.commodity,
                p_billed_unit: selector.billedUnit,
                p_regions: [...new Set(selector.regions)],
                p_accounting_basis: selector.accountingBasis,
                p_emissions_scope: selector.emissionsScope,
                p_from: selector.from,
                p_to: selector.to
            }
        );
        return ((result?.rows ?? []) as EmissionFactorRow[]).map(mapFactor);
    }

    async listPrices(
        org: string,
        selector: CarbonListSelector = {}
    ): Promise<CarbonListPage<Required<CarbonPriceSpec>>> {
        const limit = listLimit(selector);
        const result = await this.#deps.callDb(
            'organization.fn_carbon_price_list',
            {
                p_org: org,
                p_limit: limit + 1,
                p_before_id: selector.beforeId ?? null
            }
        );
        return page(
            ((result?.rows ?? []) as CarbonPriceRow[]).map(mapPrice),
            limit
        );
    }

    async addPrice(
        org: string,
        spec: CarbonPriceSpec
    ): Promise<Required<CarbonPriceSpec>> {
        const result = await this.#deps.callDb(
            'organization.fn_carbon_price_add',
            {p_org: org, p_payload: spec}
        );
        const row = result?.rows[0] as CarbonPriceRow | undefined;
        if (!row) throw new Error('carbon price insert returned no row');
        return mapPrice(row);
    }

    async resolvePrice(
        org: string,
        selector: CarbonPriceSelector
    ): Promise<Required<CarbonPriceSpec> | null> {
        const result = await this.#deps.callDb(
            'organization.fn_carbon_price_resolve',
            {
                p_org: org,
                p_scope: selector.scope,
                p_from: selector.from,
                p_to: selector.to,
                p_price_type: selector.priceType ?? null
            }
        );
        const row = result?.rows[0] as CarbonPriceRow | undefined;
        return row ? mapPrice(row) : null;
    }
}

let defaultInstance: Promise<CarbonRepository> | undefined;
export function defaultCarbonRepository(): Promise<CarbonRepository> {
    if (!defaultInstance) {
        defaultInstance = (async () => {
            const pg = await import('../PostgresProvider.js');
            return new CarbonRepository({
                callDb: pg.callMethod as CarbonDbCaller
            });
        })();
    }
    return defaultInstance;
}
