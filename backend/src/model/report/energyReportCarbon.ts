import type CommandSender from '../CommandSender';
import {type CarbonResult, computeCarbon} from './carbon';
import type {CarbonBudgetStatus} from './carbonBudget';
import {evaluateCarbonBudget} from './carbonBudget';
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
}

export interface EnergyCarbonSectionResult {
    carbonContext: DashboardCarbonContext;
    carbon: CarbonResult;
    carbonBudget: CarbonBudgetStatus;
}

export async function appendEnergyCarbonSection(
    request: EnergyCarbonSectionRequest
): Promise<EnergyCarbonSectionResult> {
    await assertDashboardOwnedBySender(
        request.dashboardId,
        request.sender,
        request.orgId
    );
    const carbonContext = await fetchDashboardCarbonContext(
        request.dashboardId,
        request.orgId
    );
    const carbon = computeCarbon({
        kwh: request.totalCons,
        factorGPerKWh: carbonContext.lbmGPerKWh
    });
    const carbonBudget = evaluateCarbonBudget({
        projectedKgCO2: projectedCarbonKg(request, carbon, carbonContext),
        budgetKg: carbonContext.budgetKg
    });
    appendCarbonRows({request, carbonContext, carbon, carbonBudget});
    return {carbonContext, carbon, carbonBudget};
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
}): void {
    if (input.carbon.kgCO2 <= 0) return;
    input.request.rows.push(
        carbonHeaderRow(),
        locationCarbonRow(input.request.totalCons, input.carbon)
    );
    const carbonMbm = marketBasedCarbon(input);
    if (carbonMbm) {
        input.request.rows.push(
            marketCarbonRow(input.request.totalCons, carbonMbm)
        );
    }
    appendSourceRows(input);
    appendBudgetRow(input);
    input.request.rows.push({...energyRowBlank()});
}

function carbonHeaderRow(): ReportRow {
    return energyRow({section: 'CARBON'});
}

function locationCarbonRow(totalCons: number, carbon: CarbonResult): ReportRow {
    return energyRow({
        device: 'Location-based (LBM)',
        consumption_kwh: totalCons,
        notes: `${carbon.kgCO2} kg CO₂e (~${carbon.equivalents.kmDriven} km driven, ${carbon.equivalents.treesYear} tree-years to absorb)`
    });
}

function marketBasedCarbon(input: {
    request: EnergyCarbonSectionRequest;
    carbonContext: DashboardCarbonContext;
}): CarbonResult | null {
    if (input.carbonContext.mbmGPerKWh === null) return null;
    return computeCarbon({
        kwh: input.request.totalCons,
        factorGPerKWh: input.carbonContext.mbmGPerKWh
    });
}

function marketCarbonRow(
    totalCons: number,
    carbonMbm: CarbonResult
): ReportRow {
    return energyRow({
        device: 'Market-based (MBM)',
        consumption_kwh: totalCons,
        notes: `${carbonMbm.kgCO2} kg CO₂e (accounts for green PPAs / RECs)`
    });
}

function appendSourceRows(input: {
    request: EnergyCarbonSectionRequest;
    carbonContext: DashboardCarbonContext;
}): void {
    const sourceBreakdown = computeCarbonSourceBreakdown({
        totalConsumedKWh: input.request.totalCons,
        totalReturnedKWh: input.request.totalRet,
        factorGPerKWh: input.carbonContext.lbmGPerKWh
    });
    if (
        sourceBreakdown.solarSelfConsumedKWh <= 0 &&
        sourceBreakdown.solarExportedKWh <= 0
    ) {
        return;
    }
    input.request.rows.push(
        gridCarbonRow(sourceBreakdown, input.carbonContext),
        solarSelfCarbonRow(sourceBreakdown)
    );
    if (sourceBreakdown.solarExportedKWh > 0) {
        input.request.rows.push(solarExportCarbonRow(sourceBreakdown));
    }
}

function gridCarbonRow(
    sourceBreakdown: CarbonSourceBreakdown,
    carbonContext: DashboardCarbonContext
): ReportRow {
    return energyRow({
        device: 'Grid (imported)',
        consumption_kwh: sourceBreakdown.gridKWh,
        notes: `${sourceBreakdown.gridKgCO2} kg CO₂e at ${carbonContext.lbmGPerKWh} g/kWh`
    });
}

function solarSelfCarbonRow(sourceBreakdown: CarbonSourceBreakdown): ReportRow {
    return energyRow({
        device: sourceBreakdown.solarSelfEstimated
            ? 'Solar (self-consumed, est.)'
            : 'Solar (self-consumed)',
        consumption_kwh: sourceBreakdown.solarSelfConsumedKWh,
        notes: sourceBreakdown.solarSelfEstimated
            ? '0 kg CO₂e — value estimated from grid metering'
            : '0 kg CO₂e (no marginal emissions)'
    });
}

function solarExportCarbonRow(
    sourceBreakdown: CarbonSourceBreakdown
): ReportRow {
    return energyRow({
        device: 'Solar (exported)',
        consumption_kwh: sourceBreakdown.solarExportedKWh,
        notes: `-${sourceBreakdown.avoidedKgCO2} kg CO₂e avoided (displaced grid)`
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
