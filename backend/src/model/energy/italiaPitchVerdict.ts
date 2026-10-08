import type {ItaliaPitchPolicy} from '../../types/api/operations';

export type {ItaliaPitchPolicy} from '../../types/api/operations';

export interface ItaliaPitchReading {
    readonly observedAt: string;
    readonly amps: number | null;
}

export type ItaliaPitchStatus =
    | 'config_missing'
    | 'data_missing'
    | 'freshness_missing'
    | 'normal'
    | 'warning'
    | 'overload'
    | 'disconnect_risk';

export interface ItaliaPitchVerdict {
    readonly pitchId: number;
    readonly status: ItaliaPitchStatus;
    readonly amps: number | null;
    readonly ratedAmps: number | null;
    readonly usedFraction: number | null;
}

export function evaluateItaliaPitchVerdict(
    policy: ItaliaPitchPolicy | null,
    readings: readonly ItaliaPitchReading[],
    now: Date
): ItaliaPitchVerdict {
    if (
        policy === null ||
        policy.ratedAmps <= 0 ||
        policy.warningFraction <= 0 ||
        policy.warningFraction > 1 ||
        policy.overloadFraction < 1 ||
        policy.overloadFraction < policy.warningFraction ||
        policy.disconnectAfterSeconds <= 0 ||
        policy.freshnessSeconds <= 0
    ) {
        return {
            pitchId: policy?.pitchId ?? 0,
            status: 'config_missing',
            amps: null,
            ratedAmps: null,
            usedFraction: null
        };
    }
    const ordered = readings
        .map((reading) => ({reading, at: Date.parse(reading.observedAt)}))
        .filter(({at}) => Number.isFinite(at))
        .sort((left, right) => left.at - right.at);
    const latest = ordered.at(-1);
    if (
        !latest ||
        latest.reading.amps === null ||
        !Number.isFinite(latest.reading.amps) ||
        latest.reading.amps < 0
    ) {
        return {
            pitchId: policy.pitchId,
            status: 'data_missing',
            amps: null,
            ratedAmps: policy.ratedAmps,
            usedFraction: null
        };
    }
    if (
        latest.at > now.getTime() ||
        now.getTime() - latest.at > policy.freshnessSeconds * 1000
    ) {
        return {
            pitchId: policy.pitchId,
            status: 'freshness_missing',
            amps: latest.reading.amps,
            ratedAmps: policy.ratedAmps,
            usedFraction: null
        };
    }
    const usedFraction = latest.reading.amps / policy.ratedAmps;
    const overloadStartedAt = overloadRunStartedAt(
        ordered,
        policy.ratedAmps * policy.overloadFraction,
        policy.freshnessSeconds * 1000
    );
    const overloadSeconds =
        overloadStartedAt === null ? 0 : (latest.at - overloadStartedAt) / 1000;
    const status: ItaliaPitchStatus =
        usedFraction > policy.overloadFraction &&
        overloadSeconds >= policy.disconnectAfterSeconds
            ? 'disconnect_risk'
            : usedFraction > 1
              ? 'overload'
              : usedFraction >= policy.warningFraction
                ? 'warning'
                : 'normal';
    return {
        pitchId: policy.pitchId,
        status,
        amps: latest.reading.amps,
        ratedAmps: policy.ratedAmps,
        usedFraction
    };
}

function overloadRunStartedAt(
    readings: readonly {reading: ItaliaPitchReading; at: number}[],
    thresholdAmps: number,
    maximumGapMs: number
): number | null {
    let startedAt: number | null = null;
    let previousAt: number | null = null;
    for (const {reading, at} of readings) {
        if (previousAt !== null && at - previousAt > maximumGapMs) {
            startedAt = null;
        }
        if (
            reading.amps !== null &&
            Number.isFinite(reading.amps) &&
            reading.amps >= 0 &&
            reading.amps > thresholdAmps
        ) {
            startedAt ??= at;
        } else {
            startedAt = null;
        }
        previousAt = at;
    }
    return startedAt;
}
