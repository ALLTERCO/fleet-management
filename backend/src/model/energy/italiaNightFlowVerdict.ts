import type {ItaliaNightFlowPolicy} from '../../types/api/operations';

export type {ItaliaNightFlowPolicy} from '../../types/api/operations';

export interface ItaliaNightFlowSample {
    readonly zoneId: number;
    readonly day: string;
    readonly minimumM3h: number | null;
    readonly siteOpen: boolean;
}

export interface ItaliaNightFlowReading {
    readonly observedAt: string;
    readonly flowM3h: number;
}

const FIFTEEN_MINUTES_MS = 15 * 60_000;

export type ItaliaNightFlowStatus =
    | 'config_missing'
    | 'data_missing'
    | 'insufficient_baseline'
    | 'normal'
    | 'leak';

export interface ItaliaNightFlowVerdict {
    readonly zoneId: number;
    readonly status: ItaliaNightFlowStatus;
    readonly latestDay: string | null;
    readonly latestMinimumM3h: number | null;
    readonly baselineM3h: number | null;
    readonly excessM3h: number | null;
    readonly estimatedLitresPerDay: number | null;
    readonly baselineSamples: number;
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

/** Returns the lowest median that was evidenced for the configured duration. */
export function sustainedMinimumM3h(
    readings: readonly ItaliaNightFlowReading[],
    sustainedMinutes: number
): number | null {
    if (!Number.isInteger(sustainedMinutes) || sustainedMinutes <= 0)
        return null;
    const samples = readings
        .map((reading) => ({
            at: Date.parse(reading.observedAt),
            value: reading.flowM3h
        }))
        .filter(
            (sample) =>
                Number.isFinite(sample.at) && Number.isFinite(sample.value)
        )
        .sort((left, right) => left.at - right.at);
    const sustainedMs = sustainedMinutes * 60_000;
    let lowest: number | null = null;
    for (let start = 0; start < samples.length; start += 1) {
        const first = samples[start];
        let end = start;
        while (end + 1 < samples.length) {
            const gap = samples[end + 1].at - samples[end].at;
            if (gap <= 0 || gap > FIFTEEN_MINUTES_MS) break;
            end += 1;
            if (samples[end].at - first.at >= sustainedMs) break;
        }
        if (samples[end].at - first.at < sustainedMs) continue;
        const level = median(
            samples.slice(start, end + 1).map((sample) => sample.value)
        );
        if (level !== null && (lowest === null || level < lowest)) {
            lowest = level;
        }
    }
    return lowest;
}

function validPolicy(policy: ItaliaNightFlowPolicy): boolean {
    return (
        Number.isInteger(policy.siteId) &&
        policy.siteId > 0 &&
        policy.timeZone.length > 0 &&
        policy.quietStartHour >= 0 &&
        policy.quietStartHour < policy.quietEndHour &&
        policy.quietEndHour <= 24 &&
        policy.sustainedMinutes >= 15 &&
        policy.minimumBaselineSamples > 0 &&
        policy.madMultiplier >= 0 &&
        policy.minimumExcessM3h >= 0
    );
}

/** Evaluates a configured zone without creating a regional fallback. */
export function evaluateItaliaNightFlowVerdicts(
    policy: ItaliaNightFlowPolicy | null,
    samples: readonly ItaliaNightFlowSample[]
): ItaliaNightFlowVerdict[] {
    if (policy === null || !validPolicy(policy)) return [];
    return policy.zones.map((zone) => {
        const known = samples
            .filter((sample) => sample.zoneId === zone.zoneId)
            .filter((sample) => sample.minimumM3h !== null)
            .sort((left, right) => left.day.localeCompare(right.day));
        const latest = known.at(-1);
        if (!latest)
            return {
                zoneId: zone.zoneId,
                status: 'data_missing',
                latestDay: null,
                latestMinimumM3h: null,
                baselineM3h: null,
                excessM3h: null,
                estimatedLitresPerDay: null,
                baselineSamples: 0
            };
        const latestMinimumM3h = latest.minimumM3h;
        if (latestMinimumM3h === null)
            throw new Error('known sample minimum invariant');
        if (!latest.siteOpen) {
            const leaking = latestMinimumM3h > 0;
            return {
                zoneId: zone.zoneId,
                status: leaking ? 'leak' : 'normal',
                latestDay: latest.day,
                latestMinimumM3h,
                baselineM3h: 0,
                excessM3h: latestMinimumM3h,
                estimatedLitresPerDay: leaking
                    ? latestMinimumM3h * 24_000
                    : null,
                baselineSamples: 0
            };
        }
        const baselineValues = known
            .slice(0, -1)
            .filter((sample) => sample.siteOpen)
            .map((sample) => sample.minimumM3h as number);
        if (baselineValues.length < policy.minimumBaselineSamples)
            return {
                zoneId: zone.zoneId,
                status: 'insufficient_baseline',
                latestDay: latest.day,
                latestMinimumM3h,
                baselineM3h: null,
                excessM3h: null,
                estimatedLitresPerDay: null,
                baselineSamples: baselineValues.length
            };
        const baseline = median(baselineValues);
        const mad =
            baseline === null
                ? null
                : median(
                      baselineValues.map((value) => Math.abs(value - baseline))
                  );
        if (baseline === null || mad === null)
            throw new Error('baseline median invariant');
        const excess = latestMinimumM3h - baseline;
        const leaking =
            excess > policy.minimumExcessM3h &&
            excess > mad * policy.madMultiplier;
        return {
            zoneId: zone.zoneId,
            status: leaking ? 'leak' : 'normal',
            latestDay: latest.day,
            latestMinimumM3h,
            baselineM3h: baseline,
            excessM3h: excess,
            estimatedLitresPerDay: leaking ? excess * 24_000 : null,
            baselineSamples: baselineValues.length
        };
    });
}
