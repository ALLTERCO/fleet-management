// Pure: decides which anomaly payloads should be emitted for the current
// report run. Keep the side-effect emit in pushReportAnomalies.

import type {ReportAnomalyPayload} from '../../modules/EventDistributor';
import {
    DEFAULT_LOCALE,
    formatProseNumber
} from '../../modules/i18n/localeNumber';
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
    /** Devices the report covered. */
    readonly devicesInScope: number;
    /** Of those, how many produced no reading at all in the window. */
    readonly devicesWithNoData: number;
    /** Devices still backfilling history — makes low coverage temporary. */
    readonly devicesCatchingUp: number;
}

// How a kWh figure is written in an anomaly sentence; the locale primitive in
// modules/i18n/localeNumber does the writing, here and in every other report
// surface, so one figure never reads two ways.
const KWH_DIGITS: Intl.NumberFormatOptions = {maximumFractionDigits: 1};

export function buildReportAnomalies(
    signal: ReportAnomalySignal,
    locale: string = DEFAULT_LOCALE
): ReportAnomalyPayload[] {
    const out: ReportAnomalyPayload[] = [];
    const alwaysOnSpike = describeAlwaysOnSpike(signal, locale);
    if (alwaysOnSpike) out.push(alwaysOnSpike);
    const dataQuality = describeLowDataQuality(signal);
    if (dataQuality) out.push(dataQuality);
    const budget = describeBudgetBreach(signal);
    if (budget) out.push(budget);
    return out;
}

function describeAlwaysOnSpike(
    signal: ReportAnomalySignal,
    locale: string
): ReportAnomalyPayload | null {
    if (signal.totalConsumedKWh <= 0) return null;
    const share = signal.alwaysOnKWh / signal.totalConsumedKWh;
    if (share < ALWAYS_ON_SPIKE_THRESHOLD) return null;
    const sharePct = Math.round(share * 100);
    return {
        kind: 'always_on_spike',
        severity: share >= ALWAYS_ON_CRITICAL_SHARE ? 'critical' : 'warning',
        title: 'High estimated continuous baseline',
        detail: `The estimated continuous baseline was ${formatProseNumber(signal.alwaysOnKWh, locale, KWH_DIGITS)} kWh, ${sharePct}% of total consumption in this period.`,
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
        title: lowDataQualityTitle(signal),
        detail: lowDataQualityDetail(signal, pct),
        value: +signal.dataQualityOverall.toFixed(3),
        threshold: DATA_QUALITY_LOW_THRESHOLD
    };
}

// Devices still backfilling explain the gap and it closes on its own, so say
// that rather than reporting missing data the reader cannot act on.
function isStillSyncing(signal: ReportAnomalySignal): boolean {
    return signal.devicesCatchingUp > 0;
}

function lowDataQualityTitle(signal: ReportAnomalySignal): string {
    return isStillSyncing(signal)
        ? 'Still loading'
        : 'Some readings are missing';
}

// Only ever states what the coverage score can support: how much arrived, how
// many devices were silent, and whether a backfill is running. Never why a
// device was silent — offline, unprovisioned and network loss look identical here.
function lowDataQualityDetail(
    signal: ReportAnomalySignal,
    pct: number
): string {
    if (isStillSyncing(signal)) {
        const {devicesCatchingUp: catching} = signal;
        const noun = catching === 1 ? 'device is' : 'devices are';
        return `${catching} ${noun} still catching up on history, so these totals will rise as it finishes. ${pct}% of the expected readings have arrived so far.`;
    }
    const lower = 'so these totals are lower than the real usage.';
    const {devicesWithNoData: silent, devicesInScope: total} = signal;
    if (silent > 0 && total > 0) {
        return `${silent} of ${total} devices sent no data for this period, ${lower}`;
    }
    return `Only ${pct}% of the expected readings arrived, ${lower}`;
}

function describeBudgetBreach(
    signal: ReportAnomalySignal
): ReportAnomalyPayload | null {
    const pct = signal.carbonBudgetOvershootPct;
    if (pct === null || pct <= 0) return null;
    return {
        kind: 'carbon_budget_breach',
        severity: pct >= BUDGET_CRITICAL_OVERSHOOT_PCT ? 'critical' : 'warning',
        title: 'Over the carbon budget',
        detail: `Emissions for this period are ${pct}% above the budget you set.`,
        value: pct,
        threshold: 0
    };
}
