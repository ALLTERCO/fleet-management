// Phase 7: change-event evaluator.
//
// Fires when a categorical/state field transitions in a specified way
// (e.g. cover position open->closed, switch off->on, climate mode
// heat->cool). The engine retrieves the previous and current values
// from per-device attribute storage and hands them here; this module
// is pure.

import {BoundedMap} from '../../boundedMap';
import {fieldFingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';
import {
    clearRuleFieldCache,
    clearRuleFieldCacheForDevice,
    ruleFieldKey
} from './ruleFieldCache';
import {deviceFieldClearMatch} from './shared';

export interface ChangeEventSample {
    previous: string | number | boolean | null | undefined;
    current: string | number | boolean | null | undefined;
}

export interface ChangeEventParams {
    /** Filter: only consider the change if prev matches this. */
    fromValue?: ReadonlyArray<string | number | boolean>;
    /** Filter: only consider the change if curr matches this. */
    toValue?: ReadonlyArray<string | number | boolean>;
    /** If true, alert if any transition happens regardless of from/to. */
    anyChange?: boolean;
}

export interface ChangeEventResult {
    matched: boolean;
    reason:
        | 'no_change'
        | 'no_previous'
        | 'from_mismatch'
        | 'to_mismatch'
        | 'matched';
    previous: ChangeEventSample['previous'];
    current: ChangeEventSample['current'];
}

export function evaluateChangeEvent(
    sample: ChangeEventSample,
    params: ChangeEventParams
): ChangeEventResult {
    const {previous, current} = sample;
    if (previous === undefined || previous === null) {
        return {matched: false, reason: 'no_previous', previous, current};
    }
    if (previous === current) {
        return {matched: false, reason: 'no_change', previous, current};
    }
    if (params.anyChange === true) {
        return {matched: true, reason: 'matched', previous, current};
    }
    if (params.fromValue && !includes(params.fromValue, previous)) {
        return {matched: false, reason: 'from_mismatch', previous, current};
    }
    if (params.toValue && !includes(params.toValue, current)) {
        return {matched: false, reason: 'to_mismatch', previous, current};
    }
    return {matched: true, reason: 'matched', previous, current};
}

function includes(
    allowed: ReadonlyArray<string | number | boolean>,
    value: string | number | boolean | null | undefined
): boolean {
    if (value === null || value === undefined) return false;
    for (const a of allowed) {
        if (a === value) return true;
    }
    return false;
}

const KIND = 'change_event';

// Previous value per (rule, subject, component.field). Bounded + TTL so a
// churning device set can't grow it without limit.
const CACHE_MAX = 50_000;
const CACHE_TTL_MS = 25 * 60 * 60 * 1000;
const previousCache = new BoundedMap<string, string | number | boolean | null>({
    maxSize: CACHE_MAX,
    ttlMs: CACHE_TTL_MS
});

function readConfig(cfg: Record<string, unknown>):
    | (ChangeEventParams & {
          component: string;
          field: string;
      })
    | null {
    const {component, field, fromValue, toValue, anyChange} = cfg;
    if (typeof component !== 'string' || !component) return null;
    if (typeof field !== 'string' || !field) return null;
    return {
        component,
        field,
        fromValue: Array.isArray(fromValue) ? fromValue : undefined,
        toValue: Array.isArray(toValue) ? toValue : undefined,
        anyChange: anyChange === true
    };
}

function readFieldValue(
    status: Record<string, unknown>,
    component: string,
    field: string
): string | number | boolean | null | undefined {
    const c = status[component];
    if (!c || typeof c !== 'object') return undefined;
    const v = (c as Record<string, unknown>)[field];
    if (v === null) return null;
    if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
    ) {
        return v;
    }
    return undefined;
}

export const changeEventEvaluator: Evaluator = {
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],
    match(event, rule, opts): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_status_changed') return null;
        const cfg = readConfig(rule.config);
        if (!cfg) return null;
        const current = readFieldValue(event.status, cfg.component, cfg.field);
        if (current === undefined) return null;

        const key = ruleFieldKey(
            rule.id,
            event.shellyID,
            cfg.component,
            cfg.field
        );
        const previous = previousCache.get(key) ?? null;
        // Preview is read-only: never advance the stored previous value.
        if (!opts?.preview) previousCache.set(key, current);

        const result = evaluateChangeEvent(
            {previous, current},
            {
                fromValue: cfg.fromValue,
                toValue: cfg.toValue,
                anyChange: cfg.anyChange
            }
        );
        if (!result.matched) return null;

        return synthesizeChangeEventHit({
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

export function clearChangeEventCacheForRule(ruleId: number): void {
    clearRuleFieldCache(previousCache, ruleId);
}

export function clearChangeEventCacheForDevice(subjectId: string): void {
    clearRuleFieldCacheForDevice(previousCache, subjectId);
}

export function synthesizeChangeEventHit(input: {
    ruleId: number;
    ruleName: string;
    shellyID: string;
    component: string;
    field: string;
    result: ChangeEventResult;
}): MatchResult {
    return {
        fingerprintV2: fieldFingerprintV2({
            ruleId: input.ruleId,
            subjectType: 'device',
            subjectId: input.shellyID,
            component: input.component,
            field: input.field
        }),
        title: `${input.shellyID} ${input.component}.${input.field} changed`,
        message:
            `${input.component}.${input.field} ` +
            `${String(input.result.previous)} → ${String(input.result.current)}. ` +
            `Rule: ${input.ruleName}.`,
        subject: {type: 'device', id: input.shellyID},
        context: {
            shellyID: input.shellyID,
            component: input.component,
            field: input.field,
            previous: input.result.previous,
            current: input.result.current
        }
    };
}
