/**
 * component_state — discrete-state comparator against a status field. The boolean/
 * enum sibling of component_threshold: fires while a field equals a target state,
 * auto-resolves when it no longer does. Covers relay on/off, door/window open,
 * presence, cover/lock state, and BLU sensors.
 *
 * Rule config (must match COMPONENT_STATE_CONFIG_SCHEMA in
 * backend/src/types/api/alert.ts; the schema↔evaluator contract test enforces
 * this):
 *   component: 'switch:0' | 'cover:0' | 'component:<id>' …
 *   field:     'output' | 'state' | 'value' …
 *   equals:    true | false | 'open' | 'closed' …  (the state that fires)
 *   severity?: optional per-match severity override
 */
import type AbstractDevice from '../../../model/AbstractDevice';
import type {AlertSeverity} from '../../../types/api/alert';
import {fieldFingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';
import {deviceDisplayName, readField} from './shared';

const KIND = 'component_state';
const COMPONENT_TARGET_PREFIX = 'component:';
const LEGACY_ENTITY_TARGET_PREFIX = 'entity:';

type StateValue = boolean | string | number;

interface StateConfig {
    component: string;
    field: string;
    equals: StateValue;
    severity?: AlertSeverity;
}

function isStateValue(v: unknown): v is StateValue {
    return (
        typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number'
    );
}

function isSeverity(v: unknown): v is AlertSeverity {
    return v === 'info' || v === 'warning' || v === 'critical';
}

function readConfig(cfg: Record<string, unknown>): StateConfig | null {
    const {component, field, equals, severity} = cfg;
    if (typeof component !== 'string' || !component) return null;
    if (typeof field !== 'string' || !field) return null;
    if (!isStateValue(equals)) return null;
    return {
        component,
        field,
        equals,
        severity: isSeverity(severity) ? severity : undefined
    };
}

type Subject = {type: 'device' | 'entity'; id: string};

// 'absent' is safe to auto-resolve: event.status is the full merged snapshot,
// so a missing field means the state genuinely no longer holds. 'unknown' =
// cannot evaluate (entity path with no device) — leave the alert untouched.
type Reading =
    | {kind: 'value'; value: StateValue; subject: Subject}
    | {kind: 'absent'; subject: Subject}
    | {kind: 'unknown'};

/** Resolve the raw field value: native component path OR logical sensor target. */
function readReading(
    event: {
        status: Record<string, unknown>;
        device?: AbstractDevice;
        shellyID: string;
    },
    cfg: StateConfig
): Reading {
    const targetPrefix = cfg.component.startsWith(COMPONENT_TARGET_PREFIX)
        ? COMPONENT_TARGET_PREFIX
        : cfg.component.startsWith(LEGACY_ENTITY_TARGET_PREFIX)
          ? LEGACY_ENTITY_TARGET_PREFIX
          : null;
    if (targetPrefix) {
        const id = cfg.component.slice(targetPrefix.length);
        const subject: Subject = {type: 'entity', id};
        if (!event.device) return {kind: 'unknown'};
        const entity = (event.device.entities ?? []).find((e) => e.id === id);
        if (!entity) return {kind: 'absent', subject};
        const status = event.device.status as Record<string, unknown>;
        const sensorId =
            entity.type === 'bthomesensor' ? entity.properties?.id : undefined;
        const backing =
            entity.type === 'bthomesensor'
                ? sensorId !== undefined
                    ? status?.[`bthomesensor:${sensorId}`]
                    : undefined
                : status?.[entity.id];
        const raw = readField(backing, cfg.field);
        if (!isStateValue(raw)) return {kind: 'absent', subject};
        return {kind: 'value', value: raw, subject};
    }
    const subject: Subject = {type: 'device', id: event.shellyID};
    const component = readField(event.status, cfg.component);
    const raw = readField(component, cfg.field);
    if (!isStateValue(raw)) return {kind: 'absent', subject};
    return {kind: 'value', value: raw, subject};
}

const WILDCARD = ':*';
const isWildcard = (component: string) => component.endsWith(WILDCARD);

function phraseState(
    field: string,
    value: StateValue
): {
    titleSuffix: string;
    messageSuffix: string;
} {
    if (field === 'output' && typeof value === 'boolean') {
        return value
            ? {titleSuffix: 'turned on', messageSuffix: 'is on'}
            : {titleSuffix: 'turned off', messageSuffix: 'is off'};
    }
    if (field === 'state') {
        return {
            titleSuffix: `is ${value}`,
            messageSuffix: `is ${value}`
        };
    }
    if (typeof value === 'boolean') {
        return value
            ? {titleSuffix: 'is active', messageSuffix: 'is active'}
            : {titleSuffix: 'is inactive', messageSuffix: 'is inactive'};
    }
    return {
        titleSuffix: `is ${value}`,
        messageSuffix: `is ${value}`
    };
}

// Concrete components to evaluate: the literal one, or every native instance of
// the type for a "switch:*"-style watch-all.
function targetComponents(
    cfg: StateConfig,
    status: Record<string, unknown>
): string[] {
    if (!isWildcard(cfg.component)) return [cfg.component];
    const type = cfg.component.slice(0, -WILDCARD.length);
    return Object.keys(status).filter((k) => k.split(':')[0] === type);
}

function matchComponent(
    event: {
        status: Record<string, unknown>;
        device?: AbstractDevice;
        shellyID: string;
    },
    rule: {id: number},
    cfg: StateConfig,
    component: string
): MatchResult | null {
    const r = readReading(event, {...cfg, component});
    if (r.kind !== 'value' || r.value !== cfg.equals) return null;
    const display =
        r.subject.type === 'entity'
            ? `${component} ${r.subject.id}`
            : deviceDisplayName(event.device) || event.shellyID;
    const phrase = phraseState(cfg.field, r.value);
    return {
        fingerprintV2: fieldFingerprintV2({
            ruleId: rule.id,
            subjectType: r.subject.type,
            subjectId: r.subject.id,
            component,
            field: cfg.field
        }),
        title: `${display} ${phrase.titleSuffix}`,
        message: `${component}.${cfg.field} ${phrase.messageSuffix}.`,
        severity: cfg.severity,
        subject: r.subject,
        context: {
            shellyID: event.shellyID,
            deviceName: display,
            component,
            field: cfg.field,
            current: r.value
        }
    };
}

// Unknown → leave as-is; still at target → keep open; otherwise resolve.
function clearComponent(
    event: {
        status: Record<string, unknown>;
        device?: AbstractDevice;
        shellyID: string;
    },
    rule: {id: number},
    cfg: StateConfig,
    component: string
): string | null {
    const r = readReading(event, {...cfg, component});
    if (r.kind === 'unknown') return null;
    if (r.kind === 'value' && r.value === cfg.equals) return null;
    return fieldFingerprintV2({
        ruleId: rule.id,
        subjectType: r.subject.type,
        subjectId: r.subject.id,
        component,
        field: cfg.field
    });
}

function configFor(rule: {
    kind: string;
    config: Record<string, unknown>;
}): StateConfig | null {
    if (rule.kind !== KIND) return null;
    return readConfig(rule.config);
}

export const componentStateEvaluator: Evaluator = {
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],

    // Single-component path for direct callers (preview/tests); the engine fires
    // via matchAll. Wildcard is owned by matchAll.
    match(event, rule): MatchResult | null {
        if (event.kind !== 'device_status_changed') return null;
        const cfg = configFor(rule);
        if (!cfg || isWildcard(cfg.component)) return null;
        return matchComponent(event, rule, cfg, cfg.component);
    },

    matchAll(event, rule): MatchResult[] {
        if (event.kind !== 'device_status_changed') return [];
        const cfg = configFor(rule);
        if (!cfg) return [];
        return targetComponents(cfg, event.status)
            .map((c) => matchComponent(event, rule, cfg, c))
            .filter((m): m is MatchResult => m !== null);
    },

    matchClear(event, rule) {
        if (event.kind !== 'device_status_changed') return null;
        const cfg = configFor(rule);
        if (!cfg || isWildcard(cfg.component)) return null;
        const fp = clearComponent(event, rule, cfg, cfg.component);
        return fp ? {fingerprintV2: fp} : null;
    },

    matchClearAll(event, rule): readonly string[] {
        if (event.kind !== 'device_status_changed') return [];
        const cfg = configFor(rule);
        if (!cfg) return [];
        return targetComponents(cfg, event.status)
            .map((c) => clearComponent(event, rule, cfg, c))
            .filter((fp): fp is string => fp !== null);
    }
};
