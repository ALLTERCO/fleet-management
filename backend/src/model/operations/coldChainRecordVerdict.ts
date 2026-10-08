import type {
    ColdChainRecordPolicy,
    ColdChainRecordSource,
    ColdChainRecordSourceVerdict,
    ColdChainRecordVerdict,
    OperationalCoverage
} from '../../types/api/operations';

export interface ColdChainRecordReading {
    sourceId: string;
    observedAt: Date | null;
    temperatureC: number | null;
    neverReported?: boolean;
}

interface LocalClock {
    date: string;
    hour: number;
}

export function evaluateColdChainRecord(
    policy: ColdChainRecordPolicy | undefined,
    readings: readonly ColdChainRecordReading[],
    now: Date
): ColdChainRecordVerdict {
    if (!policy) return configMissing('');
    const clock = localClock(now, policy.timeZone);
    if (!clock || !isEvaluablePolicy(policy)) return configMissing(policy.id);

    const readingsBySource = latestReadingsBySource(readings);
    const sources = policy.sources.map((source) =>
        sourceVerdict(
            source,
            readingsBySource.get(source.id),
            policy,
            now,
            clock
        )
    );
    const evidence = sources.filter((source) => source.evidenceRequired);
    const complete = evidence.every((source) => source.loggedToday);
    const overdue = !complete && clock.hour >= policy.deadlineHour;

    return {
        policyId: policy.id,
        date: clock.date,
        status: overallStatus(evidence, complete, overdue),
        complete,
        overdue,
        coverage: coverageOf(sources),
        sources
    };
}

function configMissing(policyId: string): ColdChainRecordVerdict {
    return {
        policyId,
        date: null,
        status: 'config_missing',
        complete: false,
        overdue: false,
        coverage: emptyCoverage(),
        sources: []
    };
}

function isEvaluablePolicy(policy: ColdChainRecordPolicy): boolean {
    if (
        policy.sources.length === 0 ||
        !Number.isInteger(policy.deadlineHour) ||
        policy.deadlineHour < 0 ||
        policy.deadlineHour > 23 ||
        !Number.isFinite(policy.freshnessSeconds) ||
        policy.freshnessSeconds <= 0
    ) {
        return false;
    }
    const evidence = policy.sources.filter((source) => source.evidenceRequired);
    return evidence.length > 0 && evidence.every(hasConfiguredLimit);
}

function hasConfiguredLimit(
    source: ColdChainRecordSource
): source is ColdChainRecordSource & {
    maxTemperatureC: number;
    limitBasis: Exclude<ColdChainRecordSource['limitBasis'], null>;
} {
    return (
        typeof source.maxTemperatureC === 'number' &&
        Number.isFinite(source.maxTemperatureC) &&
        source.limitBasis !== null
    );
}

function latestReadingsBySource(
    readings: readonly ColdChainRecordReading[]
): ReadonlyMap<string, ColdChainRecordReading> {
    const result = new Map<string, ColdChainRecordReading>();
    for (const reading of readings) {
        if (!isUsableDate(reading.observedAt)) {
            if (reading.neverReported === true && !result.has(reading.sourceId))
                result.set(reading.sourceId, reading);
            continue;
        }
        const previous = result.get(reading.sourceId);
        const previousObservedAt = previous?.observedAt;
        if (
            previous === undefined ||
            !isUsableDate(previousObservedAt) ||
            reading.observedAt.getTime() > previousObservedAt.getTime()
        ) {
            result.set(reading.sourceId, reading);
        }
    }
    return result;
}

function sourceVerdict(
    source: ColdChainRecordSource,
    reading: ColdChainRecordReading | undefined,
    policy: ColdChainRecordPolicy,
    now: Date,
    clock: LocalClock
): ColdChainRecordSourceVerdict {
    const common = {
        sourceId: source.id,
        deviceId: source.deviceId,
        maxTemperatureC: source.maxTemperatureC,
        limitBasis: source.limitBasis,
        evidenceRequired: source.evidenceRequired
    };
    if (!reading || !isUsableDate(reading.observedAt)) {
        return {
            ...common,
            status: 'data_missing',
            observedAt: null,
            temperatureC: null,
            loggedToday: false,
            neverReported: reading?.neverReported ?? null,
            silenceHours: null
        };
    }

    const silenceHours =
        (now.getTime() - reading.observedAt.getTime()) / 3_600_000;
    const observedAt = reading.observedAt.toISOString();
    const loggedToday =
        localClock(reading.observedAt, policy.timeZone)?.date === clock.date;
    if (
        typeof reading.temperatureC !== 'number' ||
        !Number.isFinite(reading.temperatureC)
    ) {
        return {
            ...common,
            status: 'data_missing',
            observedAt,
            temperatureC: null,
            loggedToday,
            neverReported: false,
            silenceHours: nonNegative(silenceHours)
        };
    }
    if (
        !Number.isFinite(silenceHours) ||
        silenceHours < 0 ||
        silenceHours > policy.freshnessSeconds / 3600
    ) {
        return {
            ...common,
            status: 'stale',
            observedAt,
            temperatureC: reading.temperatureC,
            loggedToday,
            neverReported: false,
            silenceHours: nonNegative(silenceHours)
        };
    }
    return {
        ...common,
        status:
            hasConfiguredLimit(source) &&
            reading.temperatureC > source.maxTemperatureC
                ? 'above_limit'
                : 'within_limit',
        observedAt,
        temperatureC: reading.temperatureC,
        loggedToday,
        neverReported: false,
        silenceHours
    };
}

function overallStatus(
    evidence: readonly ColdChainRecordSourceVerdict[],
    complete: boolean,
    overdue: boolean
): ColdChainRecordVerdict['status'] {
    if (evidence.some((source) => source.status === 'data_missing'))
        return 'data_missing';
    if (evidence.some((source) => source.status === 'stale')) return 'stale';
    if (complete) return 'complete';
    return overdue ? 'overdue' : 'incomplete';
}

function coverageOf(
    sources: readonly ColdChainRecordSourceVerdict[]
): OperationalCoverage {
    return {
        configuredSources: sources.length,
        observedSources: sources.filter((source) => source.observedAt !== null)
            .length,
        freshSources: sources.filter(
            (source) =>
                source.status !== 'data_missing' && source.status !== 'stale'
        ).length
    };
}

function emptyCoverage(): OperationalCoverage {
    return {configuredSources: 0, observedSources: 0, freshSources: 0};
}

function localClock(value: Date, timeZone: string): LocalClock | null {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(value);
        const byType = new Map(parts.map((part) => [part.type, part.value]));
        const year = byType.get('year');
        const month = byType.get('month');
        const day = byType.get('day');
        const hour = Number(byType.get('hour'));
        if (!year || !month || !day || !Number.isInteger(hour)) return null;
        return {date: `${year}-${month}-${day}`, hour};
    } catch {
        return null;
    }
}

function isUsableDate(value: Date | null | undefined): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

function nonNegative(value: number): number | null {
    return Number.isFinite(value) && value >= 0 ? value : null;
}
