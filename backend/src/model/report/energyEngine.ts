import {getLogger} from 'log4js';
import {tuning} from '../../config';
import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import {emitReportProgress} from '../../modules/EventDistributor';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    REPORT_GENERATE_ENERGY_PARAMS_SCHEMA,
    type ReportGenerateEnergyParams
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {detectEnergyAnomalies} from './anomalies';
import {
    buildTopConsumers,
    checkReportReconciles,
    currencySymbol,
    type EnergyReportRow,
    energyRowBlank
} from './energyEngineHelpers';
import {openEnergyReportArtifacts} from './energyReportArtifacts';
import {appendBillChargesSection} from './energyReportBillCharges';
import {appendEnergyCarbonSection} from './energyReportCarbon';
import {buildEnergyReportData} from './energyReportData';
import {appendEnergyExtendedSections} from './energyReportExtendedSections';
import {appendMeasuredSection} from './energyReportMeasured';
import {appendMeterBreakdownSection} from './energyReportMeterBreakdown';
import {
    appendPowerQualitySection,
    computePowerQuality
} from './energyReportPowerQuality';
import {appendPvSection} from './energyReportPvSection';
import {appendRecommendationSection} from './energyReportRecommendations';
import {
    appendAnomalySection,
    appendCostAnalysisSections,
    appendDataQualitySection,
    appendDayOfWeekSection,
    appendLoadDurationSection,
    appendPhaseAnalysisSection,
    appendTimeSeriesSection,
    appendTopConsumersSection
} from './energyReportRows';
import {
    appendScopeSection,
    buildDepthMap,
    overlapContributions,
    partitionContributions,
    rollupScope
} from './energyReportScopeBreakdown';
import {appendEnergySummarySections} from './energyReportSummary';
import {appendUsageProfileSection} from './energyReportUsageProfile';
import {assertValidReportTimezone} from './engineHelpers';
import {pushReportAnomalies} from './pushReportAnomalies';
import {pickRateSpread} from './rateSpread';
import {writeReportGeneratedAudit} from './reportAudit';
import type {ReportJobContext} from './reportJobContext';
import {computeTouShift} from './touShift';

const logger = getLogger('energyEngine');

// Bump when CSV columns change.
//   v1: 17 columns ending in `notes`
//   v2: 18 columns; `delta_pct` inserted between `imbalance_pct` and `notes`
const ENERGY_REPORT_SCHEMA_VERSION = 2;

// Everything the report computes besides the rows themselves — fed to the CSV
// finish() and to the JSON view meta. Superset of the artifact finish request.
interface EnergyReportComputed {
    fromLabel: string;
    toLabel: string;
    currency: string;
    totalConsumptionKWh: number;
    totalReturnedKWh: number;
    totalCost: number;
    phaseRowCount: number;
    tariffMode: string;
    touShiftSavings: number;
    carbonKgCO2: number;
    dataQualityOverall: number;
    anomalyCount: number;
    recommendationCount: number;
    alwaysOnKWh: number;
    carbonBudgetOvershootPct: number | null;
    // Data-driven sections that actually rendered (ids), for report metadata.
    extraSections: string[];
}

interface RunEnergyReportSectionsInput {
    rows: EnergyReportRow[];
    data: Awaited<ReturnType<typeof buildEnergyReportData>>;
    params: ReportGenerateEnergyParams;
    sender: CommandSender;
    context?: ReportJobContext;
}

function reportProgressOrgId(sender: CommandSender): string | null {
    return canCrossOrganizationBoundary(sender)
        ? null
        : requireOrganizationId(sender);
}

// Visible report note for the VEE gap fill — kWh priced from an estimated tariff.
function appendEstimatedTariffNote(
    rows: EnergyReportRow[],
    estimatedKWh: number
): void {
    const note = energyRowBlank();
    note.section = 'NOTE';
    note.notes = `${estimatedKWh.toFixed(1)} kWh priced from an estimated tariff (live price feed gap)`;
    rows.push(note, energyRowBlank());
}

// Single source of the report's section order. Pushes every section into `rows`
// and returns the computed totals. Reused by the CSV export and the JSON view —
// the only difference between them is the row sink and what they do afterwards.
async function runEnergyReportSections({
    rows,
    data,
    params,
    sender,
    context
}: RunEnergyReportSectionsInput): Promise<EnergyReportComputed> {
    const {
        from,
        to,
        granularity = 'day',
        tariff = 0,
        tariff_mode = 'single',
        day_rate = 0,
        night_rate = 0,
        day_start = '07:00:00',
        day_end = '23:00:00',
        dashboardId,
        sections_enabled
    } = params;
    const {
        orgId,
        shellyIDs,
        internalIds,
        deviceMap,
        mainMeterSet,
        fromDate,
        toDate,
        priorFrom,
        priorTo,
        currency,
        timezone,
        priorConsByDevice,
        priorTotalCons,
        periodDays,
        onlineCount,
        tariff: storedTariff,
        frequency,
        nominalVoltage,
        nominalHz,
        measured,
        hourlyConsumedKWh,
        locationScope,
        groupScope,
        tagScope,
        pv,
        meterBreakdown,
        timeSeries: {
            tsRows,
            deviceAgg,
            totalCons,
            totalRet,
            totalCost,
            peakPower,
            avgVoltage,
            dayCons,
            nightCons,
            dayCost,
            nightCost,
            estimatedKWh
        },
        phase: {phaseRows, phaseGroups}
    } = data;
    const currSymbol = currencySymbol(currency);
    await context?.throwIfCancelled();

    const {
        dq,
        fromLabel,
        toLabel,
        projection,
        alwaysOn,
        priorAlwaysOn,
        avgPowerFactor,
        pfPenalty
    } = await appendEnergySummarySections({
        rows,
        internalIds,
        shellyIDs,
        from,
        to,
        fromDate,
        toDate,
        priorFrom,
        priorTo,
        granularity,
        currency,
        currencySymbol: currSymbol,
        nominalVoltage,
        tariffMode: tariff_mode,
        tariff,
        dayRate: day_rate,
        nightRate: night_rate,
        dayStart: day_start,
        dayEnd: day_end,
        onlineCount,
        tsRows,
        phaseRows,
        totalCons,
        totalRet,
        totalCost,
        peakPower,
        avgVoltage,
        priorTotalCons,
        periodDays
    });

    // VEE: when a live tariff gap was filled, never hide it — log it and note
    // it on the report so the estimated portion is visible, not silent.
    if (estimatedKWh > 0) {
        logger.warn(
            'report priced %s kWh from an estimated tariff (live price feed gap)',
            estimatedKWh.toFixed(1)
        );
        appendEstimatedTariffNote(rows, estimatedKWh);
    }

    const topConsumers = buildTopConsumers(deviceAgg, deviceMap);
    checkReportReconciles(totalCost, topConsumers, logger);
    appendTopConsumersSection({
        rows,
        topConsumers,
        priorConsByDevice,
        totalCons,
        currencySymbol: currSymbol
    });
    const deviceUsage = [...deviceAgg.entries()].map(([id, agg]) => ({
        externalId: deviceMap.get(id) ?? '',
        kWh: agg.cons,
        cost: agg.cost
    }));
    // Location partitions (device once); group/tag overlap (device in each).
    // Track which sections actually render, for the report metadata.
    const extraSections: string[] = [];
    if (
        appendScopeSection({
            rows,
            title: 'CONSUMPTION BY LOCATION',
            nodes: locationScope.nodes,
            rollup: rollupScope({
                nodes: locationScope.nodes,
                contributions: partitionContributions(
                    deviceUsage,
                    locationScope.deviceNodes,
                    buildDepthMap(locationScope.nodes)
                )
            }),
            currencySymbol: currSymbol,
            shareBaseKWh: totalCons
        })
    ) {
        extraSections.push('consumption_by_location');
    }
    if (
        appendScopeSection({
            rows,
            title: 'CONSUMPTION BY GROUP',
            nodes: groupScope.nodes,
            rollup: rollupScope({
                nodes: groupScope.nodes,
                contributions: overlapContributions(
                    deviceUsage,
                    groupScope.deviceNodes
                )
            }),
            currencySymbol: currSymbol,
            shareBaseKWh: totalCons
        })
    ) {
        extraSections.push('consumption_by_group');
    }
    if (
        appendScopeSection({
            rows,
            title: 'CONSUMPTION BY TAG',
            nodes: tagScope.nodes,
            rollup: rollupScope({
                nodes: tagScope.nodes,
                contributions: overlapContributions(
                    deviceUsage,
                    tagScope.deviceNodes
                )
            }),
            currencySymbol: currSymbol,
            shareBaseKWh: totalCons
        })
    ) {
        extraSections.push('consumption_by_tag');
    }
    if (pv && appendPvSection({rows, mode: pv.mode, result: pv.result})) {
        extraSections.push('pv_summary');
    }
    if (appendMeterBreakdownSection({rows, breakdown: meterBreakdown})) {
        extraSections.push('meter_breakdown');
    }

    await appendTimeSeriesSection({rows, tsRows, currencySymbol: currSymbol});
    await appendPhaseAnalysisSection({rows, phaseRows, phaseGroups});

    const rateSpread = pickRateSpread({
        tariffMode: tariff_mode,
        dayRate: day_rate,
        nightRate: night_rate,
        tariffWindows: null
    });
    const touShift = rateSpread
        ? computeTouShift({
              peakConsumption:
                  tariff_mode === 'day_night' ? dayCons : totalCons,
              peakRate: rateSpread.peakRate,
              offPeakRate: rateSpread.offPeakRate,
              shiftableFraction: tuning.energy.touShiftableFraction
          })
        : {shiftedKWh: 0, savings: 0};

    appendCostAnalysisSections({
        rows,
        tariffMode: tariff_mode,
        dayStart: day_start,
        dayEnd: day_end,
        dayCons,
        nightCons,
        dayCost,
        nightCost,
        totalCons,
        totalCost,
        currencySymbol: currSymbol,
        touShift,
        touShiftableFraction: tuning.energy.touShiftableFraction
    });

    appendBillChargesSection({
        rows,
        tariff: storedTariff,
        peakPowerW: peakPower,
        periodDays,
        fromDate,
        toDate,
        energyCost: totalCost,
        currencySymbol: currSymbol
    });

    appendPowerQualitySection({
        rows,
        result: computePowerQuality({
            totalConsumptionKWh: totalCons,
            avgPowerFactor,
            voltageBuckets: tsRows.map((r) => ({
                min:
                    typeof r.voltage_min_v === 'number'
                        ? r.voltage_min_v
                        : null,
                max:
                    typeof r.voltage_max_v === 'number' ? r.voltage_max_v : null
            })),
            nominalVoltage,
            frequency,
            nominalHz
        })
    });

    if (appendMeasuredSection({rows, metrics: measured})) {
        extraSections.push('electrical_measurements');
    }

    const {carbonContext, carbon, carbonBudget} =
        await appendEnergyCarbonSection({
            rows,
            dashboardId,
            sender,
            orgId,
            totalCons,
            totalRet,
            projection
        });
    appendDataQualitySection({rows, dataQuality: dq, deviceMap});

    const anomalies = detectEnergyAnomalies({
        tsRows,
        phaseGroups,
        topConsumers,
        totalCons,
        mainMeterSet,
        alwaysOnKWh: alwaysOn.totalKWh,
        priorAlwaysOnKWh:
            priorAlwaysOn.totalKWh > 0 ? priorAlwaysOn.totalKWh : null,
        carbonBudgetOvershootPct: carbonBudget.overBudget
            ? carbonBudget.overshootPct
            : null
    });
    appendAnomalySection({rows, anomalies});
    appendDayOfWeekSection({rows, tsRows, timezone});
    if (
        appendUsageProfileSection({
            rows,
            consumedKWh: hourlyConsumedKWh,
            periodDays
        })
    ) {
        extraSections.push('usage_profile');
    }
    appendLoadDurationSection({rows, tsRows, peakPower});

    await appendEnergyExtendedSections({
        rows,
        orgId,
        shellyIDs,
        tsRows,
        deviceAgg,
        deviceMap,
        totalCost,
        tariff,
        currency,
        from,
        to,
        timezone,
        allowedSections: sections_enabled
    });

    const recommendations = await appendRecommendationSection({
        rows,
        tsRows,
        topConsumers,
        priorConsByDevice,
        priorTotalCons,
        totalCons,
        totalRet,
        tariff,
        alwaysOnKWh: alwaysOn.totalKWh,
        priorAlwaysOnKWh: priorAlwaysOn.totalKWh,
        touSavings: touShift.savings,
        currencySymbol: currSymbol,
        onlineCount,
        totalDevices: shellyIDs.length,
        avgPowerFactor,
        powerFactorPenaltyCost: pfPenalty?.fires ? pfPenalty.penaltyCost : null,
        carbonContext,
        internalIds,
        fromDate,
        toDate,
        periodDays
    });

    return {
        fromLabel,
        toLabel,
        currency,
        totalConsumptionKWh: totalCons,
        totalReturnedKWh: totalRet,
        totalCost,
        phaseRowCount: phaseRows.length,
        tariffMode: tariff_mode,
        touShiftSavings: touShift.savings,
        carbonKgCO2: carbon.kgCO2,
        dataQualityOverall: dq.overall,
        anomalyCount: anomalies.length,
        recommendationCount: recommendations.length,
        alwaysOnKWh: alwaysOn.totalKWh,
        carbonBudgetOvershootPct: carbonBudget.overBudget
            ? carbonBudget.overshootPct
            : null,
        extraSections
    };
}

// CSV/HTML export: build the sections into the streaming artifact sink, then
// write the files, push anomaly signals, and audit.
export async function generateEnergyReport(
    rawParams: unknown,
    sender: CommandSender,
    context?: ReportJobContext
) {
    const generateStart = Date.now();
    const params = validateOrThrow<ReportGenerateEnergyParams>(
        rawParams,
        REPORT_GENERATE_ENERGY_PARAMS_SCHEMA
    );
    assertValidReportTimezone(params.timezone);
    const progressOrgId = reportProgressOrgId(sender);
    emitReportProgress(progressOrgId, {
        kind: 'energy',
        jobId: context?.jobId,
        phase: 'started'
    });
    await context?.throwIfCancelled();
    const data = await buildEnergyReportData({params, sender});
    if (context) {
        context.estimatedRows =
            data.timeSeries.tsRows.length + data.phase.phaseRows.length;
    }
    await context?.update({
        currentPhase: 'computing',
        estimatedRows: context?.estimatedRows,
        percent: 10
    });
    await context?.throwIfCancelled();
    const session = await openEnergyReportArtifacts({
        sender,
        schemaVersion: ENERGY_REPORT_SCHEMA_VERSION,
        shellyIDs: data.shellyIDs,
        scope: data.scope,
        from: params.from,
        to: params.to,
        granularity: params.granularity ?? 'day',
        context
    });

    try {
        emitReportProgress(progressOrgId, {
            kind: 'energy',
            jobId: context?.jobId,
            phase: 'computing'
        });
        const computed = await runEnergyReportSections({
            // The streaming sink only ever holds energyRow() outputs.
            rows: session.rows as EnergyReportRow[],
            data,
            params,
            sender,
            context
        });
        pushReportAnomalies({
            organizationId: sender.getOrganizationId() ?? null,
            dashboardId:
                typeof params.dashboardId === 'number'
                    ? params.dashboardId
                    : undefined,
            signal: {
                totalConsumedKWh: computed.totalConsumptionKWh,
                alwaysOnKWh: computed.alwaysOnKWh,
                dataQualityOverall: computed.dataQualityOverall,
                carbonBudgetOvershootPct: computed.carbonBudgetOvershootPct
            }
        });
        emitReportProgress(progressOrgId, {
            kind: 'energy',
            jobId: context?.jobId,
            phase: 'writing'
        });
        const artifacts = await session.finish(computed);
        await writeReportGeneratedAudit(sender, {
            reportType: 'energy',
            rows: session.rows.length,
            meta: artifacts.csvMeta,
            generateStart
        });
        await context?.update({
            currentPhase: 'ready',
            rowsWritten: session.rows.length,
            bytesWritten: artifacts.csvMeta.size,
            percent: 100
        });
        emitReportProgress(progressOrgId, {
            kind: 'energy',
            jobId: context?.jobId,
            phase: 'done',
            durationMs: Date.now() - generateStart
        });
        return artifacts.responseMeta;
    } catch (error) {
        session.fail(error as Error);
        throw error;
    }
}
