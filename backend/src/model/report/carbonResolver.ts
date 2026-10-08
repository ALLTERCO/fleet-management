import {tuning} from '../../config/index.js';
import type {CarbonRepository} from '../../modules/repositories/CarbonRepository.js';
import type {
    CarbonAccountingBasis,
    CarbonEmissionsScope,
    CarbonPriceSpec
} from '../../types/api/carbon.js';
import type {EnergyCommodity} from '../../types/api/energy.js';
import type {ResolvedEmissionFactor} from './carbonAccounting.js';
import {fetchDashboardCarbonOverrides} from './dashboardCarbonContext.js';

export interface CarbonResolutionRequest {
    orgId: string;
    dashboardId?: number;
    commodity: EnergyCommodity;
    billedUnit: string;
    region: string;
    accountingBasis: CarbonAccountingBasis;
    emissionsScope?: CarbonEmissionsScope;
    from: string;
    to: string;
    includeCarbonPrice?: boolean;
    carbonPriceType?: CarbonPriceSpec['priceType'];
}

export interface CarbonResolution {
    factor: ResolvedEmissionFactor | null;
    price: Required<CarbonPriceSpec> | null;
    budgetKg: number | null;
}

export interface CarbonResolverDeps {
    fetchDashboardOverrides?: typeof fetchDashboardCarbonOverrides;
    deploymentFactorGPerKWh?: number;
}

export async function resolveCarbonAccounting(
    repo: CarbonRepository,
    request: CarbonResolutionRequest,
    deps: CarbonResolverDeps = {}
): Promise<CarbonResolution> {
    const fetchOverrides =
        deps.fetchDashboardOverrides ?? fetchDashboardCarbonOverrides;
    const overrides = await fetchOverrides(request.dashboardId, request.orgId);
    const dashboardFactor = dashboardOverride(request, overrides);
    const stored = dashboardFactor
        ? null
        : await repo.resolveFactor(request.orgId, {
              commodity: request.commodity,
              billedUnit: request.billedUnit,
              region: request.region,
              accountingBasis: request.accountingBasis,
              emissionsScope:
                  request.emissionsScope ??
                  (request.accountingBasis === 'direct' ? undefined : 'scope2'),
              from: request.from,
              to: request.to
          });
    const factor =
        dashboardFactor ??
        (stored
            ? {
                  id: stored.id,
                  factorKgPerUnit: stored.factorKgPerUnit,
                  source: 'factor_store' as const,
                  sourceReference: stored.sourceReference,
                  revision: stored.revision,
                  accountingBasis: stored.accountingBasis,
                  emissionsScope: stored.emissionsScope
              }
            : deploymentDefault(request, deps.deploymentFactorGPerKWh));
    const price =
        factor && request.includeCarbonPrice
            ? await repo.resolvePrice(request.orgId, {
                  scope: factor.emissionsScope,
                  from: request.from,
                  to: request.to,
                  priceType: request.carbonPriceType
              })
            : null;
    return {factor, price, budgetKg: overrides.budgetKg};
}

function dashboardOverride(
    request: CarbonResolutionRequest,
    overrides: Awaited<ReturnType<typeof fetchDashboardCarbonOverrides>>
): ResolvedEmissionFactor | null {
    if (request.commodity !== 'electricity' || request.billedUnit !== 'kWh') {
        return null;
    }
    const gPerKWh =
        request.accountingBasis === 'location_based'
            ? overrides.lbmGPerKWh
            : request.accountingBasis === 'market_based'
              ? overrides.mbmGPerKWh
              : null;
    if (gPerKWh === null) return null;
    return {
        id: null,
        factorKgPerUnit: gPerKWh / 1000,
        source: 'dashboard_override',
        sourceReference: `dashboard:${request.dashboardId}`,
        revision: null,
        accountingBasis: request.accountingBasis,
        emissionsScope: 'scope2'
    };
}

function deploymentDefault(
    request: CarbonResolutionRequest,
    factorGPerKWh = tuning.energy.emissionFactorLbmGPerKWh
): ResolvedEmissionFactor | null {
    if (
        request.commodity !== 'electricity' ||
        request.billedUnit !== 'kWh' ||
        request.accountingBasis !== 'location_based'
    ) {
        return null;
    }
    return {
        id: null,
        factorKgPerUnit: factorGPerKWh / 1000,
        source: 'deployment_default',
        sourceReference: 'deployment:energy.emissionFactorLbmGPerKWh',
        revision: null,
        accountingBasis: 'location_based',
        emissionsScope: 'scope2' as CarbonEmissionsScope
    };
}
