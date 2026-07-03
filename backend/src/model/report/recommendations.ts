/** Personalized recommendations. Pure: takes already-computed report inputs,
 *  returns a ranked, top-N list of actionable suggestions. */

export interface RecommendationInput {
    readonly totalCons: number;
    readonly priorTotalCons: number | null;
    readonly topConsumerShare: number; // share of the highest-load device, 0..1
    readonly topConsumerName: string;
    /** Prior-period share of the same device, if known. Used to suppress the
     *  spike recommendation when concentration is steady-state, not new. */
    readonly priorTopConsumerShare: number | null;
    readonly alwaysOnKWh: number;
    readonly priorAlwaysOnKWh: number | null;
    readonly minVoltage: number | null;
    readonly maxVoltage: number | null;
    readonly touSavings: number;
    readonly currencySymbol: string;
    readonly offlineCount: number;
    readonly totalDevices: number;
    /** Fleet-wide avg power factor (0..1). null when unknown. */
    readonly avgPowerFactor: number | null;
    /** Penalty cost in `currencySymbol` units estimated when PF < target. */
    readonly powerFactorPenaltyCost: number | null;
}

export interface Recommendation {
    readonly id: string;
    readonly severity: 'high' | 'medium' | 'low';
    readonly title: string;
    readonly detail: string;
    readonly priority: number;
}

export type Detector = (input: RecommendationInput) => Recommendation | null;

const VOLTAGE_LOW = 210;
const VOLTAGE_HIGH = 250;
const TOP_CONSUMER_SHARE_THRESHOLD = 0.4;
const TOP_CONSUMER_DELTA_THRESHOLD = 0.05; // 5 pp share gain vs prior
const ALWAYS_ON_WOW_DELTA_THRESHOLD = 0.2;

export const topConsumerSpike: Detector = (i) => {
    if (i.topConsumerShare < TOP_CONSUMER_SHARE_THRESHOLD) return null;
    // Suppress when the same device dominated last period too — that's
    // steady-state design, not an anomaly worth a recommendation.
    if (i.priorTopConsumerShare !== null) {
        const delta = i.topConsumerShare - i.priorTopConsumerShare;
        if (delta < TOP_CONSUMER_DELTA_THRESHOLD) return null;
    }
    const pct = Math.round(i.topConsumerShare * 100);
    return {
        id: 'top-consumer-spike',
        severity: 'medium',
        title: `Concentrated load: ${i.topConsumerName} draws ${pct}% of fleet`,
        detail: `Investigate scheduling, sizing, or load-shedding for ${i.topConsumerName}.`,
        priority: i.topConsumerShare
    };
};

export const alwaysOnSpike: Detector = (i) => {
    if (i.alwaysOnKWh <= 0 || i.priorAlwaysOnKWh === null) return null;
    if (i.priorAlwaysOnKWh <= 0) return null;
    const delta = (i.alwaysOnKWh - i.priorAlwaysOnKWh) / i.priorAlwaysOnKWh;
    if (delta < ALWAYS_ON_WOW_DELTA_THRESHOLD) return null;
    return {
        id: 'always-on-spike',
        severity: 'medium',
        title: `Standby load up ${Math.round(delta * 100)}% week-over-week`,
        detail: `Identify devices left running. Current floor: ${i.alwaysOnKWh.toFixed(2)} kWh.`,
        priority: delta
    };
};

export const voltageOutlier: Detector = (i) => {
    const lo = i.minVoltage !== null && i.minVoltage < VOLTAGE_LOW;
    const hi = i.maxVoltage !== null && i.maxVoltage > VOLTAGE_HIGH;
    if (!lo && !hi) return null;
    const detail = [
        lo ? `min ${i.minVoltage}V (<${VOLTAGE_LOW}V)` : '',
        hi ? `max ${i.maxVoltage}V (>${VOLTAGE_HIGH}V)` : ''
    ]
        .filter(Boolean)
        .join(', ');
    return {
        id: 'voltage-outlier',
        severity: 'high',
        title: 'Grid voltage outside safe band',
        detail: `Contact the utility — observed ${detail}.`,
        priority: 1
    };
};

export const touOpportunity: Detector = (i) => {
    if (i.touSavings <= 0) return null;
    return {
        id: 'tou-opportunity',
        severity: 'low',
        title: `Shift load to night → save ${i.currencySymbol}${i.touSavings.toFixed(2)}`,
        detail: 'Move dishwasher, EV charging, water heating to off-peak hours.',
        priority: 0.3
    };
};

export const deviceOffline: Detector = (i) => {
    if (i.offlineCount <= 0 || i.totalDevices <= 0) return null;
    const share = i.offlineCount / i.totalDevices;
    if (share < 0.1) return null;
    return {
        id: 'device-offline',
        severity: 'medium',
        title: `${i.offlineCount} of ${i.totalDevices} devices offline`,
        detail: 'Coverage gaps reduce report accuracy. Re-check connectivity.',
        priority: 0.5 + share
    };
};

const PF_TARGET = 0.9;

export const powerFactorPenalty: Detector = (i) => {
    if (i.avgPowerFactor === null || i.avgPowerFactor >= PF_TARGET) return null;
    if (i.powerFactorPenaltyCost === null || i.powerFactorPenaltyCost <= 0)
        return null;
    const pfRounded = Math.round(i.avgPowerFactor * 100) / 100;
    return {
        id: 'power-factor-penalty',
        severity: 'medium',
        title: `Low power factor (${pfRounded}) costs ${i.currencySymbol}${i.powerFactorPenaltyCost.toFixed(2)}`,
        detail: `Install correction capacitors to restore PF above ${PF_TARGET}.`,
        priority: PF_TARGET - i.avgPowerFactor
    };
};

export const DEFAULT_DETECTORS: readonly Detector[] = [
    voltageOutlier,
    topConsumerSpike,
    alwaysOnSpike,
    deviceOffline,
    touOpportunity,
    powerFactorPenalty
];

const DEFAULT_TOP_N = 5;

/** Runs every detector, drops nulls, sorts by severity then priority, truncates. */
export function runDetectors(
    input: RecommendationInput,
    detectors: readonly Detector[] = DEFAULT_DETECTORS,
    topN: number = DEFAULT_TOP_N
): Recommendation[] {
    const ranked = detectors
        .map((d) => d(input))
        .filter((x): x is Recommendation => x !== null)
        .sort((a, b) => {
            const severityRank = (s: Recommendation['severity']) =>
                s === 'high' ? 2 : s === 'medium' ? 1 : 0;
            const sev = severityRank(b.severity) - severityRank(a.severity);
            return sev !== 0 ? sev : b.priority - a.priority;
        });
    return ranked.slice(0, Math.max(0, topN));
}
