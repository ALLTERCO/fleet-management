import {median} from 'simple-statistics';

export type ConsumptionComparisonMode =
    | 'previous_day'
    | 'recent_days'
    | 'same_weekday';
export type ConsumptionDirection = 'up' | 'down' | 'both';

export interface ConsumptionHistoryDay {
    /** Keeps weekday selection independent of an instant. */
    localDay: string;
    total: number;
    /** Prevents partial days lowering a baseline. */
    complete: boolean;
    /** Keeps unaccepted anomalous days out of median baselines. */
    quarantined?: boolean;
}

export interface ConsumptionDeviationConfig {
    compareAgainst: ConsumptionComparisonMode;
    baselineDays: number;
    sensitivityZCutoff: number;
    direction: ConsumptionDirection;
    tolerancePct: number;
    proportionalFraction: number;
    madFloorFraction: number;
    madUnitFactor: number;
    unitFloor: number;
    baselineFitGateCvrmse: number;
}

export interface ConsumptionDeviationInput {
    evaluatedLocalDay: string;
    lowTotal: number;
    highTotal: number;
    history: readonly ConsumptionHistoryDay[];
    config: ConsumptionDeviationConfig;
}

export interface ConsumptionDeviationResult {
    verdict: 'anomalous' | 'normal' | 'no_data';
    reason?:
        | 'insufficient_valid_history'
        | 'baseline_fit_too_poor'
        | 'signed_baseline';
    direction?: 'up' | 'down';
    centre: number | null;
    mad: number | null;
    effectiveMad: number | null;
    cvrmse: number | null;
    noiseFloor: number | null;
    comparisonTotal: number | null;
    robustZ: number | null;
}

/** Covers the reference population plus quarantine. */
export function consumptionLookbackDays(input: {
    compareAgainst: ConsumptionComparisonMode;
    baselineDays: number;
    quarantineBuffer: number;
    lookbackHardCapDays: number;
}): number {
    const referenceDays =
        input.compareAgainst === 'previous_day'
            ? 1
            : input.compareAgainst === 'recent_days'
              ? input.baselineDays
              : input.baselineDays * 7;
    return Math.min(
        referenceDays + input.quarantineBuffer,
        input.lookbackHardCapDays
    );
}

/** Keeps daily-consumption decision math independent of storage and clocks. */
export function evaluateConsumptionDeviation(
    input: ConsumptionDeviationInput
): ConsumptionDeviationResult {
    const baseline = selectBaseline(input);
    if (baseline.length < requiredBaselineDays(input.config)) {
        return noData('insufficient_valid_history');
    }

    const centre = median(baseline.map((day) => day.total));
    if (baselineCrossesZero(baseline)) {
        return noData('signed_baseline');
    }

    const cvrmse = calculateCvrmse(baseline, centre);
    if (
        input.config.baselineFitGateCvrmse > 0 &&
        cvrmse > input.config.baselineFitGateCvrmse
    ) {
        return noData('baseline_fit_too_poor', {centre, cvrmse});
    }

    const mad = median(baseline.map((day) => Math.abs(day.total - centre)));
    const effectiveMad = Math.max(
        mad,
        Math.abs(centre) * input.config.madFloorFraction,
        input.config.unitFloor * input.config.madUnitFactor
    );
    const noiseFloor = Math.max(
        Math.abs(centre) * input.config.proportionalFraction,
        input.config.unitFloor
    );

    const upward = evaluateDirection({
        direction: 'up',
        comparisonTotal: input.lowTotal,
        centre,
        effectiveMad,
        noiseFloor,
        config: input.config
    });
    const downward = evaluateDirection({
        direction: 'down',
        comparisonTotal: input.highTotal,
        centre,
        effectiveMad,
        noiseFloor,
        config: input.config
    });
    const hit =
        (input.config.direction === 'up' ||
            input.config.direction === 'both') &&
        upward.matched
            ? upward
            : (input.config.direction === 'down' ||
                    input.config.direction === 'both') &&
                downward.matched
              ? downward
              : null;

    return {
        verdict: hit ? 'anomalous' : 'normal',
        ...(hit ? {direction: hit.direction} : {}),
        centre,
        mad,
        effectiveMad,
        cvrmse,
        noiseFloor,
        comparisonTotal: hit?.comparisonTotal ?? null,
        robustZ: hit?.robustZ ?? null
    };
}

function selectBaseline(
    input: ConsumptionDeviationInput
): ConsumptionHistoryDay[] {
    const complete = input.history
        .filter((day) => day.complete)
        .sort((a, b) => b.localDay.localeCompare(a.localDay));
    if (input.config.compareAgainst === 'previous_day')
        return complete.slice(0, 1);

    const eligible = complete.filter((day) => !day.quarantined);
    const sameWeekday = input.config.compareAgainst === 'same_weekday';
    const days = sameWeekday
        ? eligible.filter(
              (day) =>
                  weekday(day.localDay) === weekday(input.evaluatedLocalDay)
          )
        : eligible;
    return days.slice(0, input.config.baselineDays);
}

function requiredBaselineDays(config: ConsumptionDeviationConfig): number {
    return config.compareAgainst === 'previous_day' ? 1 : config.baselineDays;
}

function evaluateDirection(input: {
    direction: 'up' | 'down';
    comparisonTotal: number;
    centre: number;
    effectiveMad: number;
    noiseFloor: number;
    config: ConsumptionDeviationConfig;
}): {
    matched: boolean;
    direction: 'up' | 'down';
    comparisonTotal: number;
    robustZ: number;
} {
    const delta = input.comparisonTotal - input.centre;
    const robustZ = (0.6745 * delta) / input.effectiveMad;
    const signedCorrectly = input.direction === 'up' ? delta > 0 : delta < 0;
    const tolerance =
        Math.abs(input.centre) * (input.config.tolerancePct / 100);
    const zPasses =
        input.config.compareAgainst === 'previous_day' ||
        (input.direction === 'up'
            ? robustZ >= input.config.sensitivityZCutoff
            : robustZ <= -input.config.sensitivityZCutoff);
    return {
        matched:
            signedCorrectly &&
            Math.abs(delta) >= tolerance &&
            Math.abs(delta) >= input.noiseFloor &&
            zPasses,
        direction: input.direction,
        comparisonTotal: input.comparisonTotal,
        robustZ
    };
}

function calculateCvrmse(
    baseline: readonly ConsumptionHistoryDay[],
    centre: number
): number {
    if (centre === 0) {
        return baseline.every((day) => day.total === 0) ? 0 : Infinity;
    }
    const meanSquare =
        baseline.reduce((sum, day) => sum + (day.total - centre) ** 2, 0) /
        baseline.length;
    return Math.sqrt(meanSquare) / Math.abs(centre);
}

function baselineCrossesZero(
    baseline: readonly ConsumptionHistoryDay[]
): boolean {
    return (
        Math.min(...baseline.map((day) => day.total)) < 0 &&
        Math.max(...baseline.map((day) => day.total)) > 0
    );
}

function weekday(localDay: string): number {
    return new Date(`${localDay}T00:00:00Z`).getUTCDay();
}

function noData(
    reason: NonNullable<ConsumptionDeviationResult['reason']>,
    values: Partial<Pick<ConsumptionDeviationResult, 'centre' | 'cvrmse'>> = {}
): ConsumptionDeviationResult {
    return {
        verdict: 'no_data',
        reason,
        centre: values.centre ?? null,
        mad: null,
        effectiveMad: null,
        cvrmse: values.cvrmse ?? null,
        noiseFloor: null,
        comparisonTotal: null,
        robustZ: null
    };
}
