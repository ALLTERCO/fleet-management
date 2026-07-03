import {tuning} from '../../config';
import type {DashboardCarbonContext} from './dashboardCarbonContext';
import {energyRow, priorTopShare} from './energyEngineHelpers';
import {type Recommendation, runDetectors} from './recommendations';
import {suggestTimeShift} from './suggestTimeShift';
import {computeWhatIfSolar} from './whatIfSolar';

type ReportRow = Record<string, any>;

interface TopConsumer {
    deviceId: number;
    device: string;
    cons: number;
}

export interface EnergyRecommendationSectionRequest {
    rows: ReportRow[];
    tsRows: readonly ReportRow[];
    topConsumers: readonly TopConsumer[];
    priorConsByDevice: Map<number, number>;
    priorTotalCons: number;
    totalCons: number;
    totalRet: number;
    tariff: number;
    alwaysOnKWh: number;
    priorAlwaysOnKWh: number;
    touSavings: number;
    currencySymbol: string;
    onlineCount: number;
    totalDevices: number;
    avgPowerFactor: number | null;
    powerFactorPenaltyCost: number | null;
    carbonContext: DashboardCarbonContext;
    internalIds: readonly number[];
    fromDate: Date;
    toDate: Date;
    periodDays: number;
}

export async function appendRecommendationSection(
    request: EnergyRecommendationSectionRequest
): Promise<Recommendation[]> {
    const recommendations = buildRecommendations(request);
    if (recommendations.length === 0) return recommendations;
    request.rows.push(recommendationHeaderRow());
    for (const recommendation of recommendations) {
        request.rows.push(recommendationRow(recommendation));
    }
    appendWhatIfSolarRow(request);
    await appendTimeShiftRow(request);
    return recommendations;
}

function buildRecommendations(
    request: EnergyRecommendationSectionRequest
): Recommendation[] {
    const voltage = voltageRange(request.tsRows);
    const topConsumer = request.topConsumers[0];
    return runDetectors({
        totalCons: request.totalCons,
        priorTotalCons:
            request.priorTotalCons > 0 ? request.priorTotalCons : null,
        topConsumerShare: topConsumerShare(request),
        topConsumerName: topConsumer?.device ?? '',
        priorTopConsumerShare: priorTopShare(
            topConsumer?.deviceId,
            request.priorConsByDevice,
            request.priorTotalCons
        ),
        alwaysOnKWh: request.alwaysOnKWh,
        priorAlwaysOnKWh:
            request.priorAlwaysOnKWh > 0 ? request.priorAlwaysOnKWh : null,
        minVoltage: voltage.min,
        maxVoltage: voltage.max,
        touSavings: request.touSavings,
        currencySymbol: request.currencySymbol,
        offlineCount: request.totalDevices - request.onlineCount,
        totalDevices: request.totalDevices,
        avgPowerFactor: request.avgPowerFactor,
        powerFactorPenaltyCost: request.powerFactorPenaltyCost
    });
}

function voltageRange(rows: readonly ReportRow[]): {
    min: number | null;
    max: number | null;
} {
    const mins = rows
        .map((row) => row.voltage_min_v)
        .filter((value): value is number => typeof value === 'number');
    const maxes = rows
        .map((row) => row.voltage_max_v)
        .filter((value): value is number => typeof value === 'number');
    return {
        min: mins.length > 0 ? Math.min(...mins) : null,
        max: maxes.length > 0 ? Math.max(...maxes) : null
    };
}

function topConsumerShare(request: EnergyRecommendationSectionRequest): number {
    const topConsumer = request.topConsumers[0];
    if (!topConsumer || request.totalCons <= 0) return 0;
    return topConsumer.cons / request.totalCons;
}

function recommendationHeaderRow(): ReportRow {
    return energyRow({section: 'RECOMMENDATIONS'});
}

function recommendationRow(recommendation: Recommendation): ReportRow {
    return energyRow({
        device: recommendation.title,
        share_pct: recommendation.severity,
        notes: recommendation.detail
    });
}

function appendWhatIfSolarRow(
    request: EnergyRecommendationSectionRequest
): void {
    const whatIfAddedKwP = tuning.energy.whatIfSolarKwP;
    if (whatIfAddedKwP <= 0) return;
    const whatIf = computeWhatIfSolar({
        currentGridKWh: Math.max(0, request.totalCons - request.totalRet),
        currentTariff: request.tariff,
        emissionFactorGPerKWh: request.carbonContext.lbmGPerKWh,
        addedKwP: whatIfAddedKwP,
        periodDays: request.periodDays
    });
    if (whatIf.projectedGenerationKWh <= 0) return;
    request.rows.push(
        energyRow({
            device: `What-if: +${whatIfAddedKwP} kWp solar`,
            consumption_kwh: whatIf.projectedGenerationKWh,
            cost: `${request.currencySymbol}${whatIf.projectedSavingsCost.toFixed(2)}`,
            share_pct: 'low',
            notes: `Adding ${whatIfAddedKwP} kWp PV would generate ~${whatIf.projectedGenerationKWh} kWh over this period — saves ${request.currencySymbol}${whatIf.projectedSavingsCost.toFixed(2)} + ${whatIf.projectedAvoidedKgCO2} kg CO₂e`
        })
    );
}

async function appendTimeShiftRow(
    request: EnergyRecommendationSectionRequest
): Promise<void> {
    const timeShift = await suggestTimeShift({
        deviceIds: request.internalIds,
        from: request.fromDate,
        to: request.toDate,
        factorGPerKWh: request.carbonContext.lbmGPerKWh,
        maxShiftableKWh: tuning.energy.timeShiftMaxKWh,
        carbon: {
            zoneCode: tuning.electricityMaps.zone,
            apiKey: tuning.electricityMaps.apiKey,
            apiUrl: tuning.electricityMaps.url,
            timeoutMs: tuning.electricityMaps.timeoutMs
        }
    });
    if (timeShift === null) return;
    request.rows.push(
        energyRow({
            device: `Time-shift: ${timeShift.shiftedKWh} kWh from ${timeShift.fromHour}:00 → ${timeShift.toHour}:00`,
            share_pct: 'opportunity',
            notes: `Shift ${timeShift.shiftedKWh} kWh from the dirtiest hour (${timeShift.worstGPerKWh} g/kWh) to the cleanest (${timeShift.bestGPerKWh} g/kWh) → avoid ${timeShift.avoidedKgCO2} kg CO₂e`
        })
    );
}
