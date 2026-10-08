import {getLogger} from 'log4js';
import {tuning} from '../../config';
import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import {emitReportProgress} from '../../modules/EventDistributor';
import {buildFormatterContext} from '../../modules/i18n/formatterContext';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {CarbonCalculateResponse} from '../../types/api/carbon.js';
import {
    REPORT_GENERATE_ENERGY_PARAMS_SCHEMA,
    type ReportCoverageInterval,
    type ReportGenerateEnergyParams,
    type ReportMeasuredUsageCost
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {detectEnergyAnomalies} from './anomalies';
import {
    buildTopConsumers,
    checkReportReconciles,
    currencySymbol,
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import {openEnergyReportArtifacts} from './energyReportArtifacts';
import {appendBillChargesSection} from './energyReportBillCharges';
import {replayDatedReportRows} from './energyReportBoundedSeries';
import {appendEnergyCarbonSection} from './energyReportCarbon';
import {energyReportCompletenessNote} from './energyReportCompleteness';
import {buildEnergyReportData} from './energyReportData';
import {appendEnergyExtendedSections} from './energyReportExtendedSections';
import {appendEnergyReportFeedInSection} from './energyReportFeedIn';
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
import type {GasConversionDisclosure} from './gasConversion';
import {measuredUsageCost} from './measuredUsageCost';
import {pushReportAnomalies} from './pushReportAnomalies';
import {pickRateSpread} from './rateSpread';
import {writeReportGeneratedAudit} from './reportAudit';
import {enterReportPhase, type ReportJobContext} from './reportJobContext';
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
    measuredUsageCost: ReportMeasuredUsageCost;
    phaseRowCount: number;
    tariffMode: string;
    touShiftSavings: number;
    carbonKgCO2: number;
    dataQualityOverall: number;
    /** Devices covered, and how many of those produced no reading at all. */
    devicesInScope: number;
    devicesWithNoData: number;
    anomalyCount: number;
    recommendationCount: number;
    alwaysOnKWh: number;
    carbonBudgetOvershootPct: number | null;
    calculationVersion: string;
    tariffSnapshot: Record<string, unknown>;
    coverage: ReportCoverageInterval;
    emissionFactors?: {
        locationBasedGPerKWh: number;
        marketBasedGPerKWh: number | null;
    };
    carbonAccounting?: {
        primary: CarbonCalculateResponse | null;
        marketBased: CarbonCalculateResponse | null;
    };
    gasConversions: readonly GasConversionDisclosure[];
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

function appendIncompleteDataNote(
    rows: EnergyReportRow[],
    data: Awaited<ReturnType<typeof buildEnergyReportData>>
): void {
    const note = energyReportCompletenessNote(
        data.syncStatus,
        data.incompleteRanges
    );
    if (!note) return;
    rows.push(
        energyRow({
            section: 'DATA STATUS',
            notes: note
        }),
        energyRowBlank()
    );
}

function reportCoverageInterval(
    coverage: Awaited<ReturnType<typeof buildEnergyReportData>>['coverage']
): ReportCoverageInterval {
    return {
        status: coverage.status,
        requestedFrom: coverage.requestedFrom.toISOString(),
        requestedTo: coverage.requestedTo.toISOString(),
        coveredFrom: coverage.coveredFrom.toISOString(),
        coveredTo: coverage.coveredTo.toISOString(),
        fraction: coverage.fraction
    };
}

function reportTariffSnapshot(
    params: ReportGenerateEnergyParams,
    storedTariff: Awaited<ReturnType<typeof buildEnergyReportData>>['tariff'],
    currency: string
): Record<string, unknown> {
    if (storedTariff) {
        return structuredClone(storedTariff) as unknown as Record<
            string,
            unknown
        >;
    }
    return {
        mode: params.tariff_mode ?? 'single',
        tariff: params.tariff ?? 0,
        day_rate: params.day_rate ?? 0,
        night_rate: params.night_rate ?? 0,
        day_start: params.day_start ?? '07:00:00',
        day_end: params.day_end ?? '23:00:00',
        currency
    };
}

function appendMeasuredUsageCostPrecision(
    rows: EnergyReportRow[],
    cost: ReportMeasuredUsageCost,
    symbol: string
): void {
    if (!cost.roundsToZeroAtMinorUnit) return;
    rows.push(
        energyRow({
            section: 'COST PRECISION',
            cost: cost.amount,
            notes: `${symbol}${cost.amount} is a non-zero measured usage charge below the ${cost.currency} minor unit; the currency-rounded amount is ${symbol}${cost.roundedAmount}.`
        }),
        energyRowBlank()
    );
}

async function runPartialEnergyReportSections({
    rows,
    data,
    params,
    context
}: RunEnergyReportSectionsInput): Promise<EnergyReportComputed> {
    const {
        shellyIDs,
        deviceMap,
        currency,
        coverage,
        tariff: storedTariff,
        timeSeries: {
            spool: timeSeriesSpool,
            deviceAgg,
            totalCons,
            totalRet,
            totalCost,
            measuredUsageCostAmount
        },
        phase: {spool: phaseSeriesSpool, phaseGroups, rowCount: phaseRowCount}
    } = data;
    const currSymbol = currencySymbol(currency);
    const interval = reportCoverageInterval(coverage);
    const measuredCost = measuredUsageCost(measuredUsageCostAmount, currency);
    rows.push(
        energyRow({
            section: 'DATA COVERAGE',
            date: `${interval.coveredFrom} - ${interval.coveredTo}`,
            notes:
                `Partial report. Requested ${interval.requestedFrom} - ${interval.requestedTo}. ` +
                'Totals cover measured usage only. Standing charges, demand charges, taxes, projections, averages and prior-period comparisons are withheld.'
        }),
        energyRowBlank(),
        energyRow({
            section: 'SUMMARY',
            device: 'Fleet total',
            consumption_kwh: +totalCons.toFixed(3),
            returned_kwh: +totalRet.toFixed(3),
            net_kwh: +(totalCons - totalRet).toFixed(3),
            cost: `${currSymbol}${
                measuredCost.roundsToZeroAtMinorUnit
                    ? measuredCost.amount
                    : measuredCost.roundedAmount.toFixed(
                          measuredCost.fractionDigits
                      )
            }`,
            notes: 'Measured usage and usage cost over the covered interval only'
        }),
        energyRowBlank()
    );
    appendMeasuredUsageCostPrecision(rows, measuredCost, currSymbol);
    const topConsumers = buildTopConsumers(deviceAgg, deviceMap);
    checkReportReconciles(totalCost, topConsumers, logger);
    appendTopConsumersSection({
        rows,
        topConsumers,
        priorConsByDevice: new Map(),
        totalCons,
        currencySymbol: currSymbol
    });
    await context?.throwIfCancelled();
    await appendTimeSeriesSection({
        rows,
        tsRows: replayDatedReportRows(timeSeriesSpool),
        currencySymbol: currSymbol
    });
    await appendPhaseAnalysisSection({
        rows,
        phaseRows: replayDatedReportRows(phaseSeriesSpool),
        phaseGroups
    });
    return {
        fromLabel: interval.coveredFrom,
        toLabel: interval.coveredTo,
        currency,
        totalConsumptionKWh: totalCons,
        totalReturnedKWh: totalRet,
        totalCost,
        measuredUsageCost: measuredCost,
        phaseRowCount,
        tariffMode: 'single',
        touShiftSavings: 0,
        carbonKgCO2: 0,
        dataQualityOverall: 1,
        devicesInScope: shellyIDs.length,
        devicesWithNoData: 0,
        anomalyCount: 0,
        recommendationCount: 0,
        alwaysOnKWh: 0,
        carbonBudgetOvershootPct: null,
        calculationVersion: `energy-report/${ENERGY_REPORT_SCHEMA_VERSION}`,
        tariffSnapshot: reportTariffSnapshot(params, storedTariff, currency),
        gasConversions: data.gasConversions,
        coverage: interval,
        extraSections: ['partial_coverage']
    };
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
    if (data.coverage.status === 'partial') {
        return runPartialEnergyReportSections({
            rows,
            data,
            params,
            sender,
            context
        });
    }
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
        commodity,
        billedUnit,
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
        feedInPricing,
        gasConversions,
        demandSamples,
        demandDeviceSamples,
        timeSeries: {
            spool: timeSeriesSpool,
            analysisRows: timeSeriesAnalysisRows,
            devicePeakW,
            deviceAgg,
            totalCons,
            totalRet,
            totalCost,
            measuredUsageCostAmount,
            peakPower,
            avgVoltage,
            dayCons,
            nightCons,
            dayCost,
            nightCost,
            estimatedKWh,
            avgPowerFactor: streamedAvgPowerFactor,
            loadDurationBands,
            weekdayKWh,
            weekendKWh,
            dataQuality
        },
        phase: {
            spool: phaseSeriesSpool,
            analysisRows: phaseAnalysisRows,
            phaseGroups,
            rowCount: phaseRowCount
        }
    } = data;
    const electricityReport =
        commodity === 'electricity' && billedUnit === 'kWh';
    const currSymbol = currencySymbol(currency);
    const measuredCost = measuredUsageCost(measuredUsageCostAmount, currency);
    appendIncompleteDataNote(rows, data);
    await context?.throwIfCancelled();

    const {
        dq,
        fromLabel,
        toLabel,
        projection,
        alwaysOn,
        priorAlwaysOn,
        avgPowerFactor
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
        tsRows: timeSeriesAnalysisRows,
        phaseRows: phaseAnalysisRows,
        precomputedAvgPowerFactor: streamedAvgPowerFactor,
        precomputedDataQuality: dataQuality,
        totalCons,
        totalRet,
        totalCost,
        peakPower,
        avgVoltage,
        priorTotalCons,
        periodDays
    });
    appendMeasuredUsageCostPrecision(rows, measuredCost, currSymbol);

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

    await appendTimeSeriesSection({
        rows,
        tsRows: replayDatedReportRows(timeSeriesSpool),
        currencySymbol: currSymbol
    });
    await appendPhaseAnalysisSection({
        rows,
        phaseRows: replayDatedReportRows(phaseSeriesSpool),
        phaseGroups
    });

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

    const billCharges = appendBillChargesSection({
        rows,
        tariff: storedTariff,
        peakPowerW: peakPower,
        periodDays,
        fromDate,
        toDate,
        energyCost: totalCost,
        consumptionUnits: totalCons,
        currencySymbol: currSymbol,
        demandSamples
    });

    if (appendGasConversionSection(rows, gasConversions)) {
        extraSections.push('gas_conversion');
    }

    appendEnergyReportFeedInSection({
        rows,
        pricing: feedInPricing,
        importEnergyCost: totalCost,
        billedUnit: data.billedUnit
    });
    const feedInCredit =
        feedInPricing?.status === 'priced' &&
        feedInPricing.credit !== null &&
        feedInPricing.currency === currency
            ? feedInPricing.credit
            : 0;

    if (electricityReport)
        appendPowerQualitySection({
            rows,
            result: computePowerQuality({
                totalConsumptionKWh: totalCons,
                avgPowerFactor,
                voltageBuckets: timeSeriesAnalysisRows.map((r) => ({
                    min:
                        typeof r.voltage_min_v === 'number'
                            ? r.voltage_min_v
                            : null,
                    max:
                        typeof r.voltage_max_v === 'number'
                            ? r.voltage_max_v
                            : null
                })),
                nominalVoltage,
                frequency,
                nominalHz
            })
        });

    if (electricityReport && appendMeasuredSection({rows, metrics: measured})) {
        extraSections.push('electrical_measurements');
    }

    const {carbonContext, carbon, carbonBudget, accounting} =
        await appendEnergyCarbonSection({
            rows,
            dashboardId,
            sender,
            orgId,
            totalCons,
            totalRet,
            projection,
            commodity: data.commodity,
            billedUnit: data.billedUnit,
            region: params.carbonRegion ?? 'global',
            from: fromDate.toISOString(),
            to: toDate.toISOString()
        });
    appendDataQualitySection({rows, dataQuality: dq, deviceMap});

    const anomalies = detectEnergyAnomalies({
        tsRows: timeSeriesAnalysisRows,
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
    const weekdayTotal = weekdayKWh + weekendKWh;
    appendDayOfWeekSection({
        rows,
        timezone,
        split:
            weekdayTotal > 0
                ? {
                      weekdayKWh: +weekdayKWh.toFixed(3),
                      weekendKWh: +weekendKWh.toFixed(3),
                      weekdayPct:
                          Math.round((weekdayKWh / weekdayTotal) * 1_000) / 10,
                      weekendPct:
                          Math.round((weekendKWh / weekdayTotal) * 1_000) / 10
                  }
                : undefined
    });
    if (
        appendUsageProfileSection({
            rows,
            consumedKWh: hourlyConsumedKWh,
            periodDays
        })
    ) {
        extraSections.push('usage_profile');
    }
    if (electricityReport) {
        appendLoadDurationSection({
            rows,
            peakPower,
            bands: loadDurationBands
        });
    }

    await appendEnergyExtendedSections({
        rows,
        orgId,
        shellyIDs,
        tsRows: timeSeriesAnalysisRows,
        devicePeakW,
        deviceAgg,
        deviceMap,
        masterEnergyCost: totalCost,
        billCharges,
        demandDeviceSamples,
        meterBreakdown,
        shadowBillCost:
            storedTariff !== null
                ? billCharges?.total != null
                    ? billCharges.total - feedInCredit
                    : null
                : tariff > 0
                  ? totalCost - feedInCredit
                  : null,
        tariff,
        currency,
        from,
        to,
        timezone,
        billIdentity: params.billIdentity,
        organizationLevel: params.scope == null && params.locationIds == null,
        allowedSections: sections_enabled
    });

    const recommendations = electricityReport
        ? await appendRecommendationSection({
              rows,
              tsRows: timeSeriesAnalysisRows,
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
              carbonContext,
              internalIds,
              fromDate,
              toDate,
              periodDays,
              hourlyConsumedKWh
          })
        : [];

    return {
        fromLabel,
        toLabel,
        currency,
        totalConsumptionKWh: totalCons,
        totalReturnedKWh: totalRet,
        totalCost,
        measuredUsageCost: measuredCost,
        phaseRowCount,
        tariffMode: tariff_mode,
        touShiftSavings: touShift.savings,
        carbonKgCO2: carbon.kgCO2,
        dataQualityOverall: dq.overall,
        // Kept alongside the average so the anomaly message can name how many
        // devices were silent instead of only quoting a percentage.
        devicesInScope: dq.perDevice.size,
        devicesWithNoData: countSilentDevices(dq.perDevice),
        anomalyCount: anomalies.length,
        recommendationCount: recommendations.length,
        alwaysOnKWh: alwaysOn.totalKWh,
        carbonBudgetOvershootPct: carbonBudget.overBudget
            ? carbonBudget.overshootPct
            : null,
        calculationVersion: `energy-report/${ENERGY_REPORT_SCHEMA_VERSION}`,
        tariffSnapshot: reportTariffSnapshot(params, storedTariff, currency),
        emissionFactors: {
            locationBasedGPerKWh: carbonContext.lbmGPerKWh,
            marketBasedGPerKWh: carbonContext.mbmGPerKWh
        },
        carbonAccounting: accounting,
        gasConversions,
        coverage: reportCoverageInterval(data.coverage),
        extraSections
    };
}

function appendGasConversionSection(
    rows: EnergyReportRow[],
    disclosures: readonly GasConversionDisclosure[]
): boolean {
    if (disclosures.length === 0) return false;
    rows.push(
        energyRow({
            section: 'GAS CONVERSION',
            notes: 'Metered volume was converted to billed energy using the exact versioned profile and published calorific values listed below.'
        })
    );
    for (const disclosure of disclosures) {
        const calorificValues = disclosure.calorificValues
            .map(
                (value) =>
                    `${value.gasDay}: ${value.value} ${value.unit} ` +
                    `(id ${value.id}, revision ${value.revision}, ${value.sourceReference})`
            )
            .join('; ');
        rows.push(
            energyRow({
                section: 'GAS CONVERSION',
                device: `Profile ${disclosure.profileId}`,
                notes:
                    `profile revision ${disclosure.profileRevision}; ` +
                    `${disclosure.meteredUnit} → ${disclosure.billedUnit}; ` +
                    `volume ${disclosure.volumeState}; correction ${disclosure.correctionMode} ` +
                    `× ${disclosure.correctionFactor}; metric factor ${disclosure.metricFactor}; ` +
                    `energy divisor ${disclosure.energyDivisor}; ${calorificValues}`
            })
        );
    }
    rows.push(energyRowBlank());
    return true;
}

// A zero coverage score means the device produced no bucket at all in the
// window. Partial reporters are excluded — "sent nothing" is the claim we can
// defend; we cannot tell why any of them were silent.
function countSilentDevices(perDevice: ReadonlyMap<number, number>): number {
    let silent = 0;
    for (const score of perDevice.values()) if (score <= 0) silent++;
    return silent;
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
    const progressUserId = context?.userId ?? sender.getUserId();
    if (progressUserId)
        emitReportProgress(progressOrgId, progressUserId, {
            kind: 'energy',
            jobId: context?.jobId,
            phase: 'started'
        });
    await context?.throwIfCancelled();
    await enterReportPhase(context, 'reading_energy');
    const data = await buildEnergyReportData({params, sender, context});
    try {
        if (context) {
            context.estimatedRows =
                data.timeSeries.spool.length + data.phase.rowCount;
        }
        await enterReportPhase(context, 'computing', {
            estimatedRows: context?.estimatedRows
        });
        await context?.throwIfCancelled();
        // One region for the whole run: the artifacts and the live anomaly
        // push must not disagree about how a figure is written.
        const {locale: orgLocale} = await buildFormatterContext(sender);
        const session = await openEnergyReportArtifacts({
            sender,
            schemaVersion: ENERGY_REPORT_SCHEMA_VERSION,
            shellyIDs: data.shellyIDs,
            scope: data.scope,
            from: data.coverage.requestedFrom.toISOString(),
            to: data.coverage.requestedTo.toISOString(),
            granularity: params.granularity ?? 'day',
            locale: orgLocale,
            format: params.format,
            context
        });

        try {
            if (progressUserId)
                emitReportProgress(progressOrgId, progressUserId, {
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
            if (computed.coverage.status === 'complete') {
                pushReportAnomalies({
                    organizationId: sender.getOrganizationId() ?? null,
                    dashboardId:
                        typeof params.dashboardId === 'number'
                            ? params.dashboardId
                            : undefined,
                    locale: orgLocale,
                    signal: {
                        totalConsumedKWh: computed.totalConsumptionKWh,
                        alwaysOnKWh: computed.alwaysOnKWh,
                        dataQualityOverall: computed.dataQualityOverall,
                        carbonBudgetOvershootPct:
                            computed.carbonBudgetOvershootPct,
                        devicesInScope: computed.devicesInScope,
                        devicesWithNoData: computed.devicesWithNoData,
                        devicesCatchingUp: data.syncStatus.devicesCatchingUp
                    }
                });
            }
            if (progressUserId)
                emitReportProgress(progressOrgId, progressUserId, {
                    kind: 'energy',
                    jobId: context?.jobId,
                    phase: 'writing'
                });
            await enterReportPhase(context, 'writing', {
                estimatedRows: context?.estimatedRows,
                rowsWritten: session.rows.length
            });
            const artifacts = await session.finish(computed);
            await writeReportGeneratedAudit(sender, {
                reportType: 'energy',
                rows: session.rows.length,
                meta: artifacts.primaryMeta,
                generateStart
            });
            await enterReportPhase(context, 'ready', {
                rowsWritten: session.rows.length,
                bytesWritten: artifacts.primaryMeta.size
            });
            if (progressUserId)
                emitReportProgress(progressOrgId, progressUserId, {
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
    } finally {
        await data.cleanup();
    }
}
