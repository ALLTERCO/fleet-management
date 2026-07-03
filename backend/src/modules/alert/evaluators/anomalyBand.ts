// Phase 7: anomaly band evaluator.
//
// Catches values that drift outside a learned statistical band (mean ±
// k·stddev) for a metric. The engine maintains a per-(subject, field)
// rolling window outside this module; here we keep the math pure so it
// can be tested without any DB / time source.
//
// The simplest robust implementation: Welford-online mean + variance
// over a fixed-size window, then compare the current sample to
// mean ± k * stddev. K defaults to 3 (~99.7% under a normal
// assumption); the engine can pass a tighter k for tighter rules.

import {BoundedMap} from '../../boundedMap';
import {fieldFingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';
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

export const anomalyBandEvaluator: Evaluator = {
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],
    match(event, rule, opts): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_status_changed') return null;
        const cfg = readConfig(rule.config);
        if (!cfg) return null;
        const current = readNumeric(event.status, cfg.component, cfg.field);
        if (current === null) return null;

        const key = ruleFieldKey(
            rule.id,
            event.shellyID,
            cfg.component,
            cfg.field
        );
        const stored = windowCache.get(key) ?? [];
        let samples: number[];
        if (opts?.preview) {
            // Read-only: evaluate a transient window; never touch the live one.
            samples = [...stored, current].slice(-cfg.windowSamples);
        } else {
            stored.push(current);
            if (stored.length > cfg.windowSamples) {
                stored.splice(0, stored.length - cfg.windowSamples);
            }
            windowCache.set(key, stored);
            samples = stored;
        }

        const result = evaluateAnomalyBand(
            {samples},
            {
                k: cfg.k,
                minSamples: cfg.minSamples,
                minStdDev: cfg.minStdDev
            }
        );
        if (!result.matched) return null;

        return synthesizeAnomalyBandHit({
            ruleId: rule.id,
            ruleName: rule.name,
            shellyID: event.shellyID,
            component: cfg.component,
            field: cfg.field,
            result
        });
    },
    matchClear(event, rule) {
        return deviceFieldClearMatch(event, rule, KIND, readConfig);
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
