/**
 * battery_below — fires below rule.config.thresholdPct, auto-resolves above.
 *
 * Schema source of truth: BATTERY_BELOW_CONFIG_SCHEMA in
 * backend/src/types/api/alert.ts. The schema↔evaluator contract test
 * enforces this on every PR.
 */
import {envInt} from '../../../config/envReader';
import {fingerprintV2} from '../fingerprint';
import {collectSignals, type Signal} from '../signals';
import type {Evaluator, MatchResult} from '../types';
import {collectChannels, readNumber} from './shared';

const KIND = 'battery_below';

function threshold(rule: {config: Record<string, unknown>}): number {
    const v = rule.config.thresholdPct;
    if (typeof v === 'number' && v >= 0 && v <= 100) return v;
    return envInt('FM_ALERT_BATTERY_DEFAULT_PCT', 20);
}

// Hysteresis ceiling; falls back to threshold (no hysteresis) when unset.
function clearThreshold(rule: {config: Record<string, unknown>}): number {
    const fire = threshold(rule);
    const v = rule.config.clearThresholdPct;
    if (typeof v === 'number' && v >= fire && v <= 100) return v;
    return fire;
}

/** Lowest battery reading across the signal + where it came from. */
function lowestReading(signal: Signal): {pct: number; channel: string} | null {
    let lowest: {pct: number; channel: string} | null = null;
    // Native `devicepower:N.battery.percent` path.
    for (const ch of collectChannels(signal.status, 'devicepower:')) {
        const pct = readNumber(ch.component, 'battery.percent');
        if (pct !== null && (!lowest || pct < lowest.pct)) {
            lowest = {pct, channel: ch.idx};
        }
    }
    // BLU path: signals.ts emits {percent: value} for a Battery sensor.
    const directPct = readNumber(signal.status, 'percent');
    if (directPct !== null && (!lowest || directPct < lowest.pct)) {
        lowest = {pct: directPct, channel: 'battery'};
    }
    return lowest;
}

// Subject-level (not per channel): the clear can recover on any channel, so a
// per-channel fire would never auto-resolve.
function fingerprintFor(ruleId: number, signal: Signal): string {
    return fingerprintV2({
        ruleId,
        subjectType: signal.subjectType,
        subjectId: signal.subjectId
    });
}

export const batteryBelowEvaluator: Evaluator = {
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],

    match(event, rule): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_status_changed') return null;
        if (!event.device) return null;
        const limit = threshold(rule);
        for (const signal of collectSignals(event.device)) {
            const reading = lowestReading(signal);
            if (!reading || reading.pct >= limit) continue;
            return {
                fingerprintV2: fingerprintFor(rule.id, signal),
                title: `${signal.displayName} battery low`,
                message: `Battery on ${signal.displayName} is ${reading.pct}% — below ${limit}%.`,
                subject: {type: signal.subjectType, id: signal.subjectId},
                context: {
                    shellyID: signal.gatewayShellyID,
                    channel: reading.channel,
                    percent: reading.pct,
                    threshold: limit
                }
            };
        }
        return null;
    },

    // Resolve every recovered subject, not just the first.
    matchClearAll(event, rule): string[] {
        if (rule.kind !== KIND) return [];
        if (event.kind !== 'device_status_changed') return [];
        if (!event.device) return [];
        const clearLimit = clearThreshold(rule);
        const out: string[] = [];
        for (const signal of collectSignals(event.device)) {
            const reading = lowestReading(signal);
            if (!reading || reading.pct < clearLimit) continue;
            out.push(fingerprintFor(rule.id, signal));
        }
        return out;
    },

    matchClear(event, rule) {
        const [first] = this.matchClearAll?.(event, rule) ?? [];
        return first ? {fingerprintV2: first} : null;
    }
};
