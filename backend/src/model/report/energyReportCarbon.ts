import {
    type CarbonRepository,
    defaultCarbonRepository
} from '../../modules/repositories/CarbonRepository.js';
import type {CarbonCalculateResponse} from '../../types/api/carbon.js';
import type {EnergyCommodity} from '../../types/api/energy.js';
import type CommandSender from '../CommandSender';
import {type CarbonResult, computeCarbon} from './carbon';
import {computeCarbonAccounting} from './carbonAccounting.js';
import type {CarbonBudgetStatus} from './carbonBudget';
import {evaluateCarbonBudget} from './carbonBudget';
import {resolveCarbonAccounting} from './carbonResolver.js';
import {
    type CarbonSourceBreakdown,
    computeCarbonSourceBreakdown
} from './carbonSourceAttribution';
import {
    type DashboardCarbonContext,
    fetchDashboardCarbonContext
} from './dashboardCarbonContext';
import {
    assertDashboardOwnedBySender,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';

type ReportRow = Record<string, any>;

interface ProjectionSummary {
    extrapolated: boolean;
    projectedKWh: number;
}

export interface EnergyCarbonSectionRequest {
    rows: ReportRow[];
    dashboardId?: number;
    sender: CommandSender;
    orgId: string;
    totalCons: number;
    totalRet: number;
    projection: ProjectionSummary;
    commodity: EnergyCommodity;
    billedUnit: string;
    region: string;
    from: string;
    to: string;
    repository?: CarbonRepository;
}

export interface EnergyCarbonSectionResult {
    carbonContext: DashboardCarbonContext;
    carbon: CarbonResult;
    carbonBudget: CarbonBudgetStatus;
    accounting: {
        primary: CarbonCalculateResponse | null;
        marketBased: CarbonCalculateResponse | null;
    };
}

export async function appendEnergyCarbonSection(
    request: EnergyCarbonSectionRequest
): Promise<EnergyCarbonSectionResult> {
    await assertDashboardOwnedBySender(
        request.dashboardId,
        request.sender,
        request.orgId
    );
    if (request.commodity !== 'electricity' || request.billedUnit !== 'kWh') {
        return noElectricityCarbon(request);
    }
    const repo = request.repository ?? (await defaultCarbonRepository());
    const primaryResolution = await resolveCarbonAccounting(repo, {
        orgId: request.orgId,
        dashboardId: request.dashboardId,
        commodity: request.commodity,
        billedUnit: request.billedUnit,
        region: request.region,
        accountingBasis: 'location_based',
        from: request.from,
        to: request.to,
        includeCarbonPrice: true
    });
    const primaryFactor = primaryResolution.factor;
    if (!primaryFactor) return noElectricityCarbon(request);
    const marketResolution = await resolveCarbonAccounting(repo, {
        orgId: request.orgId,
        dashboardId: request.dashboardId,
        commodity: request.commodity,
        billedUnit: request.billedUnit,
        region: request.region,
        accountingBasis: 'market_based',
        from: request.from,
        to: request.to,
        includeCarbonPrice: true
    });
    const primary = computeCarbonAccounting({
        quantity: request.totalCons,
        factor: primaryFactor,
        price: primaryResolution.price,
        priceRequested: true
    });
    const marketBased = marketResolution.factor
        ? computeCarbonAccounting({
              quantity: request.totalCons,
              factor: marketResolution.factor,
              price: marketResolution.price,
              priceRequested: true
          })
        : null;
    const carbonContext: DashboardCarbonContext = {
        lbmGPerKWh: primaryFactor.factorKgPerUnit * 1000,
        mbmGPerKWh:
            marketResolution.factor === null
                ? null
                : marketResolution.factor.factorKgPerUnit * 1000,
        budgetKg: primaryResolution.budgetKg,
        source:
            primaryFactor.source === 'dashboard_override'
                ? 'dashboard'
                : primaryFactor.source === 'factor_store'
                  ? 'factor_store'
                  : 'env_default'
    };
    const carbon = computeCarbon({
        kwh: request.totalCons,
        factorGPerKWh: carbonContext.lbmGPerKWh
    });
    const carbonBudget = evaluateCarbonBudget({
        projectedKgCO2: projectedCarbonKg(request, carbon, carbonContext),
        budgetKg: carbonContext.budgetKg
    });
    appendCarbonRows({
        request,
        carbonContext,
        carbon,
        carbonBudget,
        primary,
        marketBased
    });
    return {
        carbonContext,
        carbon,
        carbonBudget,
        accounting: {primary, marketBased}
    };
}

async function noElectricityCarbon(
    request: EnergyCarbonSectionRequest
): Promise<EnergyCarbonSectionResult> {
    const carbonContext = await fetchDashboardCarbonContext(
        request.dashboardId,
        request.orgId
    );
    return {
        carbonContext,
        carbon: computeCarbon({kwh: 0, factorGPerKWh: 0}),
        carbonBudget: evaluateCarbonBudget({
            projectedKgCO2: 0,
            budgetKg: null
        }),
        accounting: {primary: null, marketBased: null}
    };
}

function projectedCarbonKg(
    request: EnergyCarbonSectionRequest,
    carbon: CarbonResult,
    carbonContext: DashboardCarbonContext
): number {
    if (!request.projection.extrapolated) return carbon.kgCO2;
    return +(
        (request.projection.projectedKWh * carbonContext.lbmGPerKWh) /
        1000
    ).toFixed(2);
}

function appendCarbonRows(input: {
    request: EnergyCarbonSectionRequest;
    carbonContext: DashboardCarbonContext;
    carbon: CarbonResult;
    carbonBudget: CarbonBudgetStatus;
    primary: CarbonCalculateResponse;
    marketBased: CarbonCalculateResponse | null;
}): void {
    if (input.request.totalCons <= 0) return;
    input.request.rows.push(
        carbonHeaderRow(),
        locationCarbonRow(input.request, input.carbon, input.primary)
    );
    if (input.marketBased) {
        input.request.rows.push(
            marketCarbonRow(input.request, input.marketBased)
        );
    }
    appendSourceRows(input);
    appendBudgetRow(input);
    appendCarbonValueRows(input);
    input.request.rows.push({...energyRowBlank()});
}

function carbonHeaderRow(): ReportRow {
    return energyRow({section: 'CARBON'});
}

function locationCarbonRow(
    request: EnergyCarbonSectionRequest,
    carbon: CarbonResult,
    accounting: CarbonCalculateResponse
): ReportRow {
    return energyRow({
        device: 'Location-based (LBM)',
        consumption_kwh: request.totalCons,
        notes: `Project impact: ${accounting.projectImpactKgCO2e} kg CO₂e; ${scope2Disclosure(accounting)} (~${carbon.equivalents.kmDriven} km driven, ${carbon.equivalents.treesYear} tree-years); ${factorDisclosure(accounting, request)}`
    });
}

function marketCarbonRow(
    request: EnergyCarbonSectionRequest,
    accounting: CarbonCalculateResponse
): ReportRow {
    return energyRow({
        device: 'Market-based (MBM)',
        consumption_kwh: request.totalCons,
        notes: `Project impact: ${accounting.projectImpactKgCO2e} kg CO₂e; ${scope2Disclosure(accounting)} (accounts for green PPAs / RECs); ${factorDisclosure(accounting, request)}`
    });
}

function scope2Disclosure(accounting: CarbonCalculateResponse): string {
    return accounting.scope2KgCO2e === null
        ? 'Scope 2: not applicable'
        : `Scope 2: ${accounting.scope2KgCO2e} kg CO₂e`;
}

function factorDisclosure(
    accounting: CarbonCalculateResponse,
    request: EnergyCarbonSectionRequest
): string {
    const revision =
        accounting.factor.revision === null
            ? ''
            : ` revision ${accounting.factor.revision}`;
    return `factor ${accounting.factor.factorKgPerUnit} kg CO₂e/${request.billedUnit}, region ${request.region}, ${accounting.factor.source} (${accounting.factor.sourceReference}${revision})`;
}

function appendSourceRows(input: {
    request: EnergyCarbonSectionRequest;
    carbonContext: DashboardCarbonContext;
}): void {
    input.request.rows.push(
        ...carbonSourceRows({
            totalConsumedKWh: input.request.totalCons,
            totalReturnedKWh: input.request.totalRet,
            factorGPerKWh: input.carbonContext.lbmGPerKWh
        })
    );
}

export function carbonSourceRows(input: {
    totalConsumedKWh: number;
    totalReturnedKWh: number;
    factorGPerKWh: number;
}): ReportRow[] {
    const sourceBreakdown = computeCarbonSourceBreakdown({
        totalImportedKWh: input.totalConsumedKWh,
        totalExportedKWh: input.totalReturnedKWh,
        factorGPerKWh: input.factorGPerKWh
    });
    if (sourceBreakdown.exportedKWh <= 0) return [];
    return [
        gridCarbonRow(sourceBreakdown, input.factorGPerKWh),
        exportedEnergyRow(sourceBreakdown)
    ];
}

function gridCarbonRow(
    sourceBreakdown: CarbonSourceBreakdown,
    factorGPerKWh: number
): ReportRow {
    return energyRow({
        device: 'Grid import (measured)',
        consumption_kwh: sourceBreakdown.importedKWh,
        notes: `${sourceBreakdown.scope2KgCO2} kg CO₂e at ${factorGPerKWh} g/kWh; exports are not netted from Scope 2`
    });
}

function exportedEnergyRow(sourceBreakdown: CarbonSourceBreakdown): ReportRow {
    return energyRow({
        device: 'Grid export (measured)',
        returned_kwh: sourceBreakdown.exportedKWh,
        notes: 'Generation source, self-consumption, and avoided emissions are unavailable without generation metering'
    });
}

function appendBudgetRow(input: {
    request: EnergyCarbonSectionRequest;
    carbonBudget: CarbonBudgetStatus;
}): void {
    if (!input.carbonBudget.hasBudget) return;
    const status = input.carbonBudget.overBudget
        ? `OVER by ${input.carbonBudget.overshootPct}%`
        : 'on track';
    input.request.rows.push(
        energyRow({
            device: 'Budget',
            notes: `${input.carbonBudget.projectedKg} kg projected vs ${input.carbonBudget.budgetKg} kg budget — ${status}`
        })
    );
}

function appendCarbonValueRows(input: {
    request: EnergyCarbonSectionRequest;
    primary: CarbonCalculateResponse;
    marketBased: CarbonCalculateResponse | null;
}): void {
    for (const [label, result] of [
        ['Location-based', input.primary],
        ['Market-based', input.marketBased]
    ] as const) {
        if (result?.carbonPriceStatus === 'unavailable_or_ambiguous') {
            input.request.rows.push(
                energyRow({
                    device: `${label} carbon valuation (separate)`,
                    notes: 'Unavailable: configure exactly one effective carbon price (or select its type); utility bill is unchanged'
                })
            );
            continue;
        }
        if (!result?.carbonValue) continue;
        const value = result.carbonValue;
        input.request.rows.push(
            energyRow({
                device: `${label} carbon valuation (separate)`,
                notes: `${value.amount} ${value.currency} at ${value.amountPerTonne} ${value.currency}/tCO₂e (${value.priceType}); disclosed separately and not added to the utility bill`
            })
        );
    }
}
