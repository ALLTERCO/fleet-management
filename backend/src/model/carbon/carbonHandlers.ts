import type {CarbonRepository} from '../../modules/repositories/CarbonRepository.js';
import RpcError from '../../rpc/RpcError.js';
import {validateOrThrow} from '../../rpc/validateOrThrow.js';
import {isSupportedCurrency} from '../../types/api/_currency.js';
import {
    CARBON_CALCULATE_PARAMS_SCHEMA,
    CARBON_LIST_PARAMS_SCHEMA,
    CARBON_PRICE_SPEC_SCHEMA,
    type CarbonCalculateParams,
    type CarbonListParams,
    type CarbonPriceSpec,
    EMISSION_FACTOR_SPEC_SCHEMA,
    type EmissionFactorSpec
} from '../../types/api/carbon.js';
import type {TariffBilledUnit} from '../../types/api/tariff.js';
import {computeCarbonAccounting} from '../report/carbonAccounting.js';
import {resolveCarbonAccounting} from '../report/carbonResolver.js';
import {quantityMetric} from '../report/tariffQuantity.js';
import {isAllDayWindow, isOvernightWindow} from '../timeWindow.js';

export interface CarbonSenderCapabilities {
    getOrganizationId(): string | undefined;
}

function requireOrg(sender: CarbonSenderCapabilities): string {
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    return org;
}

function assertPeriod(from: string, to: string | null | undefined): void {
    const start = new Date(from).getTime();
    const end = to == null ? null : new Date(to).getTime();
    if (!Number.isFinite(start) || (end !== null && !Number.isFinite(end))) {
        throw RpcError.InvalidParams(
            'effective period must use ISO timestamps'
        );
    }
    if (
        end !== null &&
        (isAllDayWindow(start, end) || isOvernightWindow(start, end))
    ) {
        throw RpcError.InvalidParams('effectiveTo must be after effectiveFrom');
    }
}

function assertText(value: string, field: string): void {
    if (value.trim().length === 0) {
        throw RpcError.InvalidParams(`${field} must not be blank`);
    }
}

function assertCanonicalCommodityUnit(
    commodity: EmissionFactorSpec['commodity'],
    billedUnit: string
): void {
    if (!quantityMetric(commodity, billedUnit as TariffBilledUnit)) {
        throw RpcError.InvalidParams(
            `billedUnit '${billedUnit}' is not valid for commodity '${commodity}'`
        );
    }
}

export async function handleListEmissionFactors(
    rawParams: unknown,
    sender: CarbonSenderCapabilities,
    repo: CarbonRepository
) {
    const params = validateOrThrow<CarbonListParams>(
        rawParams ?? {},
        CARBON_LIST_PARAMS_SCHEMA
    );
    return repo.listFactors(requireOrg(sender), params);
}

export async function handleAddEmissionFactor(
    rawParams: unknown,
    sender: CarbonSenderCapabilities,
    repo: CarbonRepository
) {
    const spec = validateOrThrow<EmissionFactorSpec>(
        rawParams,
        EMISSION_FACTOR_SPEC_SCHEMA
    );
    assertPeriod(spec.effectiveFrom, spec.effectiveTo);
    assertText(spec.billedUnit, 'billedUnit');
    assertCanonicalCommodityUnit(spec.commodity, spec.billedUnit);
    assertText(spec.region, 'region');
    assertText(spec.sourceReference, 'sourceReference');
    if (spec.accountingBasis !== 'direct' && spec.emissionsScope !== 'scope2') {
        throw RpcError.InvalidParams(
            'location-based and market-based factors must use scope2'
        );
    }
    if (spec.accountingBasis === 'direct' && spec.emissionsScope === 'scope2') {
        throw RpcError.InvalidParams(
            'direct factors must use scope1 or scope3, not scope2'
        );
    }
    return {factor: await repo.addFactor(requireOrg(sender), spec)};
}

export async function handleListPrices(
    rawParams: unknown,
    sender: CarbonSenderCapabilities,
    repo: CarbonRepository
) {
    const params = validateOrThrow<CarbonListParams>(
        rawParams ?? {},
        CARBON_LIST_PARAMS_SCHEMA
    );
    return repo.listPrices(requireOrg(sender), params);
}

export async function handleAddPrice(
    rawParams: unknown,
    sender: CarbonSenderCapabilities,
    repo: CarbonRepository
) {
    const spec = validateOrThrow<CarbonPriceSpec>(
        rawParams,
        CARBON_PRICE_SPEC_SCHEMA
    );
    assertPeriod(spec.effectiveFrom, spec.effectiveTo);
    assertText(spec.name, 'name');
    assertText(spec.sourceReference, 'sourceReference');
    if (!isSupportedCurrency(spec.currency)) {
        throw RpcError.InvalidParams(
            `currency '${spec.currency}' is not a supported ISO 4217 code`
        );
    }
    return {price: await repo.addPrice(requireOrg(sender), spec)};
}

export async function handleCalculate(
    rawParams: unknown,
    sender: CarbonSenderCapabilities,
    repo: CarbonRepository
) {
    const params = validateOrThrow<CarbonCalculateParams>(
        rawParams,
        CARBON_CALCULATE_PARAMS_SCHEMA
    );
    assertPeriod(params.from, params.to);
    assertCanonicalCommodityUnit(params.commodity, params.billedUnit);
    if (params.accountingBasis === 'direct' && !params.emissionsScope) {
        throw RpcError.InvalidParams(
            'emissionsScope is required when accountingBasis is direct'
        );
    }
    if (
        params.accountingBasis !== 'direct' &&
        params.emissionsScope !== undefined &&
        params.emissionsScope !== 'scope2'
    ) {
        throw RpcError.InvalidParams(
            'location-based and market-based calculations use scope2'
        );
    }
    const orgId = requireOrg(sender);
    const resolved = await resolveCarbonAccounting(repo, {
        ...params,
        orgId
    });
    if (!resolved.factor) {
        throw RpcError.NotFound(
            'emission_factor',
            `${params.commodity}/${params.billedUnit}/${params.region}/${params.accountingBasis}`
        );
    }
    return computeCarbonAccounting({
        quantity: params.quantity,
        factor: resolved.factor,
        price: resolved.price,
        priceRequested: params.includeCarbonPrice === true
    });
}
