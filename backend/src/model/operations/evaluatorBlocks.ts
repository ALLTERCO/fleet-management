export type RangeEvaluationState =
    | 'config_missing'
    | 'data_missing'
    | 'below'
    | 'within'
    | 'above';

export interface RangeEvaluation {
    state: RangeEvaluationState;
    value: number | null;
    min: number | null;
    max: number | null;
}

export function evaluateRange(input: {
    value: number | null;
    min: number | null;
    max: number | null;
}): RangeEvaluation {
    assertOptionalFinite(input.min, 'range minimum');
    assertOptionalFinite(input.max, 'range maximum');
    if (input.min !== null && input.max !== null && input.min > input.max)
        throw new Error('range minimum must not exceed maximum');
    if (input.min === null && input.max === null)
        return {...input, state: 'config_missing'};
    if (input.value === null || !Number.isFinite(input.value))
        return {...input, value: null, state: 'data_missing'};
    if (input.min !== null && input.value < input.min)
        return {...input, state: 'below'};
    if (input.max !== null && input.value > input.max)
        return {...input, state: 'above'};
    return {...input, state: 'within'};
}

export type FreshnessEvaluationState = 'data_missing' | 'stale' | 'fresh';

export interface FreshnessEvaluation {
    state: FreshnessEvaluationState;
    ageMs: number | null;
}

export function evaluateFreshness(input: {
    observedAt: Date | null;
    now: Date;
    maxAgeMs: number;
}): FreshnessEvaluation {
    assertDate(input.now, 'current time');
    assertNonNegativeFinite(input.maxAgeMs, 'maximum age');
    if (input.observedAt === null) return {state: 'data_missing', ageMs: null};
    assertDate(input.observedAt, 'observation time');
    const ageMs = input.now.getTime() - input.observedAt.getTime();
    if (ageMs < 0)
        throw new Error('observation time must not be in the future');
    return {state: ageMs <= input.maxAgeMs ? 'fresh' : 'stale', ageMs};
}

export interface DurationSample {
    at: Date;
    matches: boolean;
}

export interface DurationEvaluation {
    state: 'data_missing' | 'not_met' | 'met';
    durationMs: number;
}

export function evaluateDuration(input: {
    samples: readonly DurationSample[];
    minimumDurationMs: number;
    maximumGapMs: number;
}): DurationEvaluation {
    assertNonNegativeFinite(input.minimumDurationMs, 'minimum duration');
    assertNonNegativeFinite(input.maximumGapMs, 'maximum sample gap');
    if (input.samples.length === 0)
        return {state: 'data_missing', durationMs: 0};
    const times = input.samples.map((sample) => {
        assertDate(sample.at, 'duration sample time');
        return sample.at.getTime();
    });
    assertAscending(times, 'duration samples');
    let runStart: number | null = null;
    let previous: number | null = null;
    let longest = 0;
    for (let index = 0; index < input.samples.length; index += 1) {
        const sample = input.samples[index];
        const at = times[index];
        const contiguous =
            previous === null || at - previous <= input.maximumGapMs;
        if (!sample.matches || !contiguous)
            runStart = sample.matches ? at : null;
        else if (runStart === null) runStart = at;
        if (sample.matches && runStart !== null)
            longest = Math.max(longest, at - runStart);
        previous = at;
    }
    return {
        state: longest >= input.minimumDurationMs ? 'met' : 'not_met',
        durationMs: longest
    };
}

export interface PeerComparisonEvaluation {
    state:
        | 'data_missing'
        | 'insufficient_peers'
        | 'zero_median'
        | 'healthy'
        | 'attention';
    median: number | null;
    peerCount: number;
    differenceFraction: number | null;
}

export function evaluatePeerComparison(input: {
    value: number | null;
    peers: readonly number[];
    minimumPeers: number;
    attentionFraction: number;
}): PeerComparisonEvaluation {
    if (!Number.isInteger(input.minimumPeers) || input.minimumPeers < 1)
        throw new Error('minimum peers must be a positive integer');
    assertNonNegativeFinite(input.attentionFraction, 'attention fraction');
    const peers = input.peers.filter(Number.isFinite);
    if (input.value === null || !Number.isFinite(input.value))
        return {
            state: 'data_missing',
            median: null,
            peerCount: peers.length,
            differenceFraction: null
        };
    if (peers.length < input.minimumPeers)
        return {
            state: 'insufficient_peers',
            median: median(peers),
            peerCount: peers.length,
            differenceFraction: null
        };
    const peerMedian = median(peers);
    if (peerMedian === null)
        throw new Error('peer median requires at least one finite peer');
    if (peerMedian === 0)
        return {
            state: 'zero_median',
            median: peerMedian,
            peerCount: peers.length,
            differenceFraction: null
        };
    const differenceFraction = round(
        (input.value - peerMedian) / peerMedian,
        6
    );
    return {
        state:
            differenceFraction <= -input.attentionFraction
                ? 'attention'
                : 'healthy',
        median: peerMedian,
        peerCount: peers.length,
        differenceFraction
    };
}

export interface OperationalSchedule {
    hour: number;
    minute: number;
}

export function latestScheduledOccurrence(input: {
    schedules: readonly OperationalSchedule[];
    timezone: string;
    now: Date;
}): Date {
    if (input.schedules.length === 0)
        throw new Error('at least one schedule is required');
    assertDate(input.now, 'current time');
    for (const schedule of input.schedules) validateSchedule(schedule);
    const localNow = localDateTime(input.now, input.timezone);
    const minuteOfDay = localNow.hour * 60 + localNow.minute;
    const dueToday = input.schedules.filter(
        (schedule) => schedule.hour * 60 + schedule.minute <= minuteOfDay
    );
    const candidates = dueToday.length > 0 ? dueToday : input.schedules;
    const schedule = candidates.reduce((latest, candidate) =>
        candidate.hour * 60 + candidate.minute >
        latest.hour * 60 + latest.minute
            ? candidate
            : latest
    );
    const date = dueToday.length > 0 ? localNow : previousLocalDate(localNow);
    return localDateTimeToUtc({...date, ...schedule, timezone: input.timezone});
}

export interface SequenceEvaluation<TStep extends string> {
    state: 'pending' | 'out_of_order' | 'complete';
    next: TStep | null;
}

export function evaluateSequence<TStep extends string>(input: {
    expected: readonly TStep[];
    observed: readonly TStep[];
}): SequenceEvaluation<TStep> {
    if (input.expected.length === 0)
        throw new Error('expected sequence must not be empty');
    const mismatch = input.observed.findIndex(
        (step, index) => input.expected[index] !== step
    );
    if (mismatch !== -1 || input.observed.length > input.expected.length)
        return {
            state: 'out_of_order',
            next:
                input.expected[Math.min(mismatch, input.expected.length - 1)] ??
                null
        };
    if (input.observed.length === input.expected.length)
        return {state: 'complete', next: null};
    return {
        state: 'pending',
        next: input.expected[input.observed.length] ?? null
    };
}

export interface OperationalCoverage {
    configuredSources: number;
    observedSources: number;
    freshSources: number;
}

export function aggregateOperationalCoverage(input: {
    configured: readonly string[];
    observed: readonly string[];
    fresh: readonly string[];
}): OperationalCoverage {
    const configured = new Set(input.configured);
    const observed = new Set(input.observed.filter((id) => configured.has(id)));
    const fresh = new Set(input.fresh.filter((id) => observed.has(id)));
    return {
        configuredSources: configured.size,
        observedSources: observed.size,
        freshSources: fresh.size
    };
}

export type OperationalScope =
    | {kind: 'organization'; organizationId: string}
    | {kind: 'location'; organizationId: string; locationId: number}
    | {kind: 'device'; organizationId: string; deviceId: string};

export function parseOperationalScope(value: unknown): OperationalScope {
    if (!isRecord(value))
        throw new Error('operational scope must be an object');
    const organizationId = nonEmptyString(
        value.organizationId,
        'organization id'
    );
    if (value.kind === 'organization')
        return {kind: 'organization', organizationId};
    if (value.kind === 'location') {
        if (!Number.isInteger(value.locationId) || Number(value.locationId) < 1)
            throw new Error('location id must be a positive integer');
        return {
            kind: 'location',
            organizationId,
            locationId: Number(value.locationId)
        };
    }
    if (value.kind === 'device')
        return {
            kind: 'device',
            organizationId,
            deviceId: nonEmptyString(value.deviceId, 'device id')
        };
    throw new Error('operational scope kind is not supported');
}

interface LocalDateTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

function localDateTime(instant: Date, timezone: string): LocalDateTime {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: nonEmptyString(timezone, 'timezone'),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(instant);
    const part = (type: string) =>
        Number(parts.find((item) => item.type === type)?.value ?? NaN);
    const value = {
        year: part('year'),
        month: part('month'),
        day: part('day'),
        hour: part('hour') % 24,
        minute: part('minute')
    };
    if (Object.values(value).some((item) => !Number.isFinite(item)))
        throw new Error('timezone did not produce a complete local date');
    return value;
}

function previousLocalDate(date: LocalDateTime): LocalDateTime {
    const previous = new Date(
        Date.UTC(date.year, date.month - 1, date.day - 1)
    );
    return {
        year: previous.getUTCFullYear(),
        month: previous.getUTCMonth() + 1,
        day: previous.getUTCDate(),
        hour: 0,
        minute: 0
    };
}

function localDateTimeToUtc(input: LocalDateTime & {timezone: string}): Date {
    let timestamp = Date.UTC(
        input.year,
        input.month - 1,
        input.day,
        input.hour,
        input.minute
    );
    const requested = timestamp;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const local = localDateTime(new Date(timestamp), input.timezone);
        const actual = Date.UTC(
            local.year,
            local.month - 1,
            local.day,
            local.hour,
            local.minute
        );
        const delta = actual - requested;
        if (delta === 0) break;
        timestamp -= delta;
    }
    return new Date(timestamp);
}

function validateSchedule(schedule: OperationalSchedule): void {
    if (
        !Number.isInteger(schedule.hour) ||
        schedule.hour < 0 ||
        schedule.hour > 23
    )
        throw new Error('schedule hour must be between 0 and 23');
    if (
        !Number.isInteger(schedule.minute) ||
        schedule.minute < 0 ||
        schedule.minute > 59
    )
        throw new Error('schedule minute must be between 0 and 59');
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function assertOptionalFinite(value: number | null, name: string): void {
    if (value !== null && !Number.isFinite(value))
        throw new Error(`${name} must be finite`);
}

function assertNonNegativeFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value < 0)
        throw new Error(`${name} must be a non-negative finite number`);
}

function assertDate(value: Date, name: string): void {
    if (!Number.isFinite(value.getTime()))
        throw new Error(`${name} must be a valid date`);
}

function assertAscending(values: readonly number[], name: string): void {
    if (values.some((value, index) => index > 0 && value < values[index - 1]))
        throw new Error(`${name} must be ordered by time`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new Error(`${name} must be a non-empty string`);
    return value.trim();
}
