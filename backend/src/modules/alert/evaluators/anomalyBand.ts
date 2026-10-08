// Keep each meter's baseline separate so readings cannot train unrelated meters.

import {BoundedMap} from '../../boundedMap';
import {fieldFingerprintV2} from '../fingerprint';
import type {ClearMatch, Evaluator, MatchResult} from '../types';
import {
    clearRuleFieldCache,
    clearRuleFieldCacheForDevice,
    ruleFieldKey
} from './ruleFieldCache';
import {deviceFieldClearMatch} from './shared';

export interface AnomalyBandSeries {
    /** Most recent samples first OR oldest first — order doesn't affect
     *  mean/variance, but does decide which is the "current" sample. We
     *  treat the LAST element as the current sample. */
    samples: ReadonlyArray<number>;
}

export interface AnomalyBandParams {
    /** Multiplier on stddev that defines the band edges. */
    k: number;
    /** Minimum samples needed before we'll report an anomaly. */
    minSamples?: number;
    /** Minimum stddev to consider — guards against flat-line history
     *  producing 0 stddev and triggering on a tiny change. */
    minStdDev?: number;
}

export interface AnomalyBandResult {
    matched: boolean;
    direction: 'above' | 'below' | 'inside' | 'insufficient_data';
    current: number | null;
    mean: number;
    stdDev: number;
    upperBound: number;
    lowerBound: number;
    sampleCount: number;
}

const DEFAULT_MIN_SAMPLES = 12;
const DEFAULT_MIN_STDDEV = 1e-9;

export function evaluateAnomalyBand(
    series: AnomalyBandSeries,
    params: AnomalyBandParams
): AnomalyBandResult {
    const minSamples = params.minSamples ?? DEFAULT_MIN_SAMPLES;
    const minStdDev = params.minStdDev ?? DEFAULT_MIN_STDDEV;
    const samples = series.samples;
    const sampleCount = samples.length;

    if (sampleCount === 0) {
        return {
            matched: false,
            direction: 'insufficient_data',
            current: null,
            mean: 0,
            stdDev: 0,
            upperBound: 0,
            lowerBound: 0,
            sampleCount: 0
        };
    }

    const current = samples[sampleCount - 1];
    const baseline = samples.slice(0, sampleCount - 1);
    const baselineCount = baseline.length;

    if (baselineCount < minSamples) {
        return {
            matched: false,
            direction: 'insufficient_data',
            current,
            mean: 0,
            stdDev: 0,
            upperBound: 0,
            lowerBound: 0,
            sampleCount
        };
    }

    const {mean, stdDev} = welford(baseline);
    const effectiveStdDev = Math.max(stdDev, minStdDev);
    const upperBound = mean + params.k * effectiveStdDev;
    const lowerBound = mean - params.k * effectiveStdDev;

    let direction: AnomalyBandResult['direction'] = 'inside';
    if (current > upperBound) direction = 'above';
    else if (current < lowerBound) direction = 'below';

    return {
        matched: direction === 'above' || direction === 'below',
        direction,
        current,
        mean,
        stdDev,
        upperBound,
        lowerBound,
        sampleCount
    };
}

function welford(values: ReadonlyArray<number>): {
    mean: number;
    stdDev: number;
} {
    let n = 0;
    let mean = 0;
    let m2 = 0;
    for (const x of values) {
        n += 1;
        const delta = x - mean;
        mean += delta / n;
        const delta2 = x - mean;
        m2 += delta * delta2;
    }
    const variance = n > 1 ? m2 / (n - 1) : 0;
    return {mean, stdDev: Math.sqrt(variance)};
}

const KIND = 'anomaly_band';

// Rolling sample window per (rule, subject, component.field). Bounded + TTL so
// a churning device set can't grow it without limit.
const CACHE_MAX = 50_000;
const CACHE_TTL_MS = 25 * 60 * 60 * 1000;
const windowCache = new BoundedMap<string, number[]>({
    maxSize: CACHE_MAX,
    ttlMs: CACHE_TTL_MS
});

interface AnomalyConfig {
    component: string;
    field: string;
    k: number;
    windowSamples: number;
    minSamples?: number;
    minStdDev?: number;
}

function readConfig(cfg: Record<string, unknown>): AnomalyConfig | null {
    const {component, field, k, windowSamples, minSamples, minStdDev} = cfg;
    if (typeof component !== 'string' || !component) return null;
    if (typeof field !== 'string' || !field) return null;
    if (typeof k !== 'number' || !Number.isFinite(k)) return null;
    if (typeof windowSamples !== 'number' || windowSamples < 1) return null;
    return {
        component,
        field,
        k,
        windowSamples: Math.floor(windowSamples),
        minSamples:
            typeof minSamples === 'number' ? Math.floor(minSamples) : undefined,
        minStdDev: typeof minStdDev === 'number' ? minStdDev : undefined
    };
}

function readNumeric(
    status: Record<string, unknown>,
    component: string,
    field: string
): number | null {
    const c = status[component];
    if (!c || typeof c !== 'object') return null;
    const v = (c as Record<string, unknown>)[field];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const WILDCARD = ':*';
const isWildcard = (component: string) => component.endsWith(WILDCARD);

// Concrete components to evaluate: the literal one, or every native instance of
// the type for an "em:*"-style watch-all.
function targetComponents(
    cfg: AnomalyConfig,
    status: Record<string, unknown>
): string[] {
    if (!isWildcard(cfg.component)) return [cfg.component];
    const type = cfg.component.slice(0, -WILDCARD.length);
    return Object.keys(status).filter((k) => k.split(':')[0] === type);
}

// One concrete component's band.
//
// The cache key MUST carry the concrete component, never cfg.component: with
// `em:*` the raw config value would put em:0, em:1 and em:2 into a single
// sample series, so the baseline would be a mean across unrelated meters and
// every anomaly reported would be noise. Each meter learns its own normal.
function matchComponent(
    event: {shellyID: string; status: Record<string, unknown>},
    rule: {id: number; name: string},
    cfg: AnomalyConfig,
    component: string,
    preview: boolean
): MatchResult | null {
    const current = readNumeric(event.status, component, cfg.field);
    if (current === null) return null;

    const key = ruleFieldKey(rule.id, event.shellyID, component, cfg.field);
    const stored = windowCache.get(key) ?? [];

    // evaluateAnomalyBand takes the last value as the reading under test and
    // everything before it as the baseline, so `stored` is exactly the history
    // this reading should be judged against.
    const result = evaluateAnomalyBand(
        {samples: [...stored, current]},
        {k: cfg.k, minSamples: cfg.minSamples, minStdDev: cfg.minStdDev}
    );

    if (!preview) {
        // An anomaly must not become part of what counts as normal. Kept in
        // the window it pulled the mean up and widened the band for every
        // later check, so the SECOND occurrence of a fault was quieter than
        // the first and a sustained fault went silent altogether — the
        // detector learning to accept the thing it exists to catch.
        if (!result.matched) {
            stored.push(current);
            if (stored.length > cfg.windowSamples) {
                stored.splice(0, stored.length - cfg.windowSamples);
            }
        }
        windowCache.set(key, stored);
    }

    if (!result.matched) return null;

    return synthesizeAnomalyBandHit({
        ruleId: rule.id,
        ruleName: rule.name,
        shellyID: event.shellyID,
        component,
        field: cfg.field,
        result
    });
}

function configFor(rule: {
    kind: string;
    config: Record<string, unknown>;
}): AnomalyConfig | null {
    if (rule.kind !== KIND) return null;
    return readConfig(rule.config);
}

export const anomalyBandEvaluator: Evaluator = {
    stateful: true,
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],
    // Single-component path for direct callers (preview/tests); the engine
    // fires via matchAll. Wildcard is owned by matchAll, so a rule can never
    // answer the same event twice.
    match(event, rule, opts): MatchResult | null {
        if (event.kind !== 'device_status_changed') return null;
        const cfg = configFor(rule);
        if (!cfg || isWildcard(cfg.component)) return null;
        return matchComponent(
            event,
            rule,
            cfg,
            cfg.component,
            opts?.preview === true
        );
    },

    matchAll(event, rule, opts): MatchResult[] {
        if (event.kind !== 'device_status_changed') return [];
        const cfg = configFor(rule);
        if (!cfg) return [];
        return targetComponents(cfg, event.status)
            .map((c) =>
                matchComponent(event, rule, cfg, c, opts?.preview === true)
            )
            .filter((m): m is MatchResult => m !== null);
    },

    matchClear(event, rule) {
        const cfg = configFor(rule);
        if (cfg && isWildcard(cfg.component)) return null;
        return deviceFieldClearMatch(event, rule, KIND, readConfig);
    },

    matchClearAll(event, rule): readonly ClearMatch[] {
        if (event.kind !== 'device_status_changed') return [];
        const cfg = configFor(rule);
        if (!cfg) return [];
        return targetComponents(cfg, event.status).map((component) => ({
            fingerprintV2: fieldFingerprintV2({
                ruleId: rule.id,
                subjectType: 'device',
                subjectId: event.shellyID,
                component,
                field: cfg.field
            })
        }));
    }
};

export function clearAnomalyBandCacheForRule(ruleId: number): void {
    clearRuleFieldCache(windowCache, ruleId);
}

export function clearAnomalyBandCacheForDevice(subjectId: string): void {
    clearRuleFieldCacheForDevice(windowCache, subjectId);
}

export function synthesizeAnomalyBandHit(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    component: string;
    field: string;
    result: AnomalyBandResult;
}): MatchResult {
    const dirText = input.result.direction === 'above' ? 'above' : 'below';
    return {
        fingerprintV2: fieldFingerprintV2({
            ruleId: input.ruleId,
            subjectType: 'device',
            subjectId: input.shellyID,
            component: input.component,
            field: input.field
        }),
        title: `${input.shellyID} ${input.component}.${input.field} anomaly`,
        message:
            `${input.component}.${input.field}=${input.result.current} is ` +
            `${dirText} the learned band [${input.result.lowerBound.toFixed(3)}, ${input.result.upperBound.toFixed(3)}] ` +
            `(mean=${input.result.mean.toFixed(3)}, σ=${input.result.stdDev.toFixed(3)}). ` +
            `Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            component: input.component,
            field: input.field,
            current: input.result.current,
            mean: input.result.mean,
            stdDev: input.result.stdDev,
            upperBound: input.result.upperBound,
            lowerBound: input.result.lowerBound,
            direction: input.result.direction
        }
    };
}
