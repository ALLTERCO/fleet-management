// Pure: decides which anomaly payloads should be emitted for the current
// report run. Keep the side-effect emit in pushReportAnomalies.

import type {ReportAnomalyPayload} from '../../modules/EventDistributor';
import {ALWAYS_ON_SPIKE_THRESHOLD} from './anomalies';

const DATA_QUALITY_LOW_THRESHOLD = 0.5;
const ALWAYS_ON_CRITICAL_SHARE = 0.4;
const DATA_QUALITY_CRITICAL = 0.25;
const BUDGET_CRITICAL_OVERSHOOT_PCT = 25;

export interface ReportAnomalySignal {
    readonly totalConsumedKWh: number;
    readonly alwaysOnKWh: number;
    readonly dataQualityOverall: number;
    readonly carbonBudgetOvershootPct: number | null;
}

export function buildReportAnomalies(
    signal: ReportAnomalySignal
): ReportAnomalyPayload[] {
    const out: ReportAnomalyPayload[] = [];
    const alwaysOnSpike = describeAlwaysOnSpike(signal);
    if (alwaysOnSpike) out.push(alwaysOnSpike);
    const dataQuality = describeLowDataQuality(signal);
    if (dataQuality) out.push(dataQuality);
    const budget = describeBudgetBreach(signal);
    if (budget) out.push(budget);
    return out;
}

function describeAlwaysOnSpike(
    signal: ReportAnomalySignal
): ReportAnomalyPayload | null {
    if (signal.totalConsumedKWh <= 0) return null;
    const share = signal.alwaysOnKWh / signal.totalConsumedKWh;
    if (share < ALWAYS_ON_SPIKE_THRESHOLD) return null;
    const sharePct = Math.round(share * 100);
    return {
        kind: 'always_on_spike',
        severity: share >= ALWAYS_ON_CRITICAL_SHARE ? 'critical' : 'warning',
        title: 'Always-on load is elevated',
        detail: `Always-on baseline draws ${signal.alwaysOnKWh.toFixed(1)} kWh (${sharePct}% of total).`,
        value: +share.toFixed(3),
        threshold: ALWAYS_ON_SPIKE_THRESHOLD
    };
}

function describeLowDataQuality(
    signal: ReportAnomalySignal
): ReportAnomalyPayload | null {
    if (signal.dataQualityOverall >= DATA_QUALITY_LOW_THRESHOLD) return null;
    const pct = Math.round(signal.dataQualityOverall * 100);
    return {
        kind: 'data_quality_low',
        severity:
            signal.dataQualityOverall < DATA_QUALITY_CRITICAL
                ? 'critical'
                : 'warning',
        title: 'Data quality is degraded',
        detail: `Only ${pct}% of expected telemetry buckets arrived for this period.`,
        value: +signal.dataQualityOverall.toFixed(3),
        threshold: DATA_QUALITY_LOW_THRESHOLD
    };
}

function describeBudgetBreach(
    signal: ReportAnomalySignal
): ReportAnomalyPayload | null {
    const pct = signal.carbonBudgetOvershootPct;
    if (pct === null || pct <= 0) return null;
    return {
        kind: 'carbon_budget_breach',
        severity: pct >= BUDGET_CRITICAL_OVERSHOOT_PCT ? 'critical' : 'warning',
        title: 'Carbon budget exceeded',
        detail: `Period emissions are ${pct}% over the configured CO₂ budget.`,
        value: pct,
        threshold: 0
    };
}
