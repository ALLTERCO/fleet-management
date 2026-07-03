// Fires when (componentType, event) matches the rule and the payload
// satisfies the optional predicate. Generic over every event the device
// declares — no per-event code. Pure; the engine feeds in events.

import {fieldFingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult, NormalizedEvent} from '../types';

const KIND = 'device_event';

type PrimitiveAttr = string | number | boolean;
type Predicate = Readonly<Record<string, PrimitiveAttr>>;

interface DeviceEventConfig {
    componentType: string;
    /** Optional: pin to one instance (e.g. bthomedevice:200) instead of every
     *  instance of the type — lets a rule target a specific remote/channel. */
    componentKey?: string;
    event: string;
    predicate?: Predicate;
}

function readConfig(raw: Record<string, unknown>): DeviceEventConfig | null {
    const {componentType, componentKey, event, predicate} = raw;
    if (typeof componentType !== 'string' || componentType.length === 0) {
        return null;
    }
    if (typeof event !== 'string' || event.length === 0) return null;
    const parsedPredicate = readPredicate(predicate);
    if (parsedPredicate === undefined) return null;
    const config: DeviceEventConfig = {componentType, event};
    if (typeof componentKey === 'string' && componentKey.length > 0) {
        config.componentKey = componentKey;
    }
    if (parsedPredicate !== null) config.predicate = parsedPredicate;
    return config;
}

// undefined = schema violation, drop. null = no predicate.
function readPredicate(raw: unknown): Predicate | null | undefined {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, PrimitiveAttr> = {};
    for (const [key, value] of Object.entries(raw as object)) {
        if (!isPrimitiveAttr(value)) return undefined;
        out[key] = value;
    }
    return out;
}

function isPrimitiveAttr(value: unknown): value is PrimitiveAttr {
    return (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    );
}

function predicateMatches(
    predicate: Predicate | undefined,
    attrs: Record<string, unknown>
): boolean {
    if (!predicate) return true;
    for (const [key, expected] of Object.entries(predicate)) {
        if (attrs[key] !== expected) return false;
    }
    return true;
}

interface HitInput {
    ruleId: number;
    ruleName: string;
    event: Extract<NormalizedEvent, {kind: 'device_event_received'}>;
}

function synthesizeHit(input: HitInput): MatchResult {
    const {ruleId, ruleName, event} = input;
    return {
        fingerprintV2: fieldFingerprintV2({
            ruleId,
            subjectType: 'device',
            subjectId: event.shellyID,
            component: event.componentKey,
            field: event.event
        }),
        title: `${event.shellyID} ${event.componentKey} ${event.event}`,
        message:
            `Device ${event.shellyID} pushed event ` +
            `${event.componentKey}.${event.event}. Rule: ${ruleName}.`,
        subject: {type: 'device', id: event.shellyID},
        context: {
            shellyID: event.shellyID,
            componentType: event.componentType,
            componentKey: event.componentKey,
            event: event.event,
            ts: event.ts,
            attrs: event.attrs
        }
    };
}

export const deviceEventEvaluator: Evaluator = {
    triggerKinds: ['device_event_received'],
    match(event, rule): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_event_received') return null;
        const config = readConfig(rule.config);
        if (!config) return null;
        if (config.componentType !== event.componentType) return null;
        if (config.componentKey && config.componentKey !== event.componentKey) {
            return null;
        }
        if (config.event !== event.event) return null;
        if (!predicateMatches(config.predicate, event.attrs)) return null;
        return synthesizeHit({
            ruleId: rule.id,
            ruleName: rule.name,
            event
        });
    }
};
