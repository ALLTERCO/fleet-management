/**
 * component_threshold — numeric comparator against a status field.
 *
 * Rule config (must match COMPONENT_THRESHOLD_CONFIG_SCHEMA in
 * backend/src/types/api/alert.ts; the schema↔evaluator contract test
 * enforces this on every PR):
 *
 *   component: 'temperature:0' | 'em:0' | 'component:<id>' …
 *   field:     'tC' | 'voltage' | 'value' …
 *   operator:  'gt'|'gte'|'lt'|'lte'|'eq'|'neq'
 *   threshold: number
 *   severity?: optional per-match severity override
 *
 * `component: 'component:<id>'` is a logical sensor target for BLU/composed
 * sensors. It usually reads the backing `bthomesensor:N.value` status field.
 * Use `Alert.Rule.ListMetricPaths` to discover native component paths and
 * logical sensor paths.
 */
import type AbstractDevice from '../../../model/AbstractDevice';
import type {AlertSeverity} from '../../../types/api/alert';
import {fieldFingerprintV2} from '../fingerprint';
import {fieldUnit} from '../metricCatalog';
import {resolveThreshold} from '../perDeviceAttr';
import {alertTargetComponents, componentRuleInputTypes} from '../signals';
import type {ClearMatch, Evaluator, MatchResult} from '../types';
import {eventDeviceDisplayName, readField, readNumber} from './shared';

const KIND = 'component_threshold';

type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

interface ThresholdConfig {
    component: string;
    field: string;
    /** BTHome object name a 'bthomesensor:*' watch must match. */
    objName?: string;
    operator: Operator;
    // Raw values: number OR "${attr}" template; resolved per-fire.
    thresholdRaw: number | string;
    clearThresholdRaw?: number | string;
    severity?: AlertSeverity;
}

function readConfig(cfg: Record<string, unknown>): ThresholdConfig | null {
    const {
        component,
        field,
        objName,
        operator,
        threshold,
        clearThreshold,
        severity
    } = cfg;
    if (typeof component !== 'string' || !component) return null;
    if (typeof field !== 'string' || !field) return null;
    if (typeof threshold !== 'number' && typeof threshold !== 'string') {
        return null;
    }
    if (!isOperator(operator)) return null;
    return {
        component,
        field,
        objName: typeof objName === 'string' && objName ? objName : undefined,
        operator,
        thresholdRaw: threshold,
        clearThresholdRaw:
            typeof clearThreshold === 'number' ||
            typeof clearThreshold === 'string'
                ? clearThreshold
                : undefined,
        severity: isSeverity(severity) ? severity : undefined
    };
}

function isOperator(v: unknown): v is Operator {
    return (
        v === 'gt' ||
        v === 'gte' ||
        v === 'lt' ||
        v === 'lte' ||
        v === 'eq' ||
        v === 'neq'
    );
}
function isSeverity(v: unknown): v is AlertSeverity {
    return v === 'info' || v === 'warning' || v === 'critical';
}

function evalOperator(
    operator: Operator,
    current: number,
    target: number
): boolean {
    switch (operator) {
        case 'gt':
            return current > target;
        case 'gte':
            return current >= target;
        case 'lt':
            return current < target;
        case 'lte':
            return current <= target;
        case 'eq':
            return current === target;
        case 'neq':
            return current !== target;
    }
}

const COMPONENT_TARGET_PREFIX = 'component:';
const LEGACY_ENTITY_TARGET_PREFIX = 'entity:';

const WILDCARD = ':*';
const isWildcard = (component: string) => component.endsWith(WILDCARD);

/** Resolve the reading: native status path OR entity id path. */
function readReading(
    event: {
        shellyID: string;
        status: Record<string, unknown>;
        device?: AbstractDevice;
        deviceName?: string;
    },
    cfg: ThresholdConfig
): {current: number; subject: {type: 'device' | 'entity'; id: string}} | null {
    const targetPrefix = cfg.component.startsWith(COMPONENT_TARGET_PREFIX)
        ? COMPONENT_TARGET_PREFIX
        : cfg.component.startsWith(LEGACY_ENTITY_TARGET_PREFIX)
          ? LEGACY_ENTITY_TARGET_PREFIX
          : null;
    if (targetPrefix) {
        const id = cfg.component.slice(targetPrefix.length);
        const entity = (event.device?.entities ?? []).find((e) => e.id === id);
        const deviceStatus = event.device?.status as
            | Record<string, unknown>
            | undefined;
        const backing =
            event.status[id] ??
            (entity?.type === 'bthomesensor'
                ? deviceStatus?.[`bthomesensor:${entity.properties.id}`]
                : entity
                  ? deviceStatus?.[entity.id]
                  : undefined);
        if (!backing) return null;
        const current = readNumber(backing, cfg.field);
        if (current === null) return null;
        return {current, subject: {type: 'entity', id}};
    }
    const component = readField(event.status, cfg.component);
    if (!component) return null;
    const current = readNumber(component, cfg.field);
    if (current === null) return null;
    return {current, subject: {type: 'device', id: event.shellyID}};
}

// One concrete component. `component` is always a real id, never a wildcard,
// so the fingerprint and the message name the thing that actually breached.
function matchComponent(
    event: {
        shellyID: string;
        status: Record<string, unknown>;
        device?: AbstractDevice;
    },
    rule: {id: number},
    cfg: ThresholdConfig,
    component: string
): MatchResult | null {
    const threshold = resolveThreshold(cfg.thresholdRaw, event.device);
    if (threshold === null) return null;
    const r = readReading(event, {...cfg, component});
    if (!r) return null;
    if (!evalOperator(cfg.operator, r.current, threshold)) return null;

    const display =
        r.subject.type === 'entity'
            ? `${component} ${r.subject.id}`
            : eventDeviceDisplayName(event);
    return {
        fingerprintV2: fieldFingerprintV2({
            ruleId: rule.id,
            subjectType: r.subject.type,
            subjectId: r.subject.id,
            component,
            field: cfg.field
        }),
        title: `${display} threshold breach`,
        message: readingText('Fired', {
            cfg,
            component,
            current: r.current,
            threshold
        }),
        severity: cfg.severity,
        subject: r.subject,
        context: {
            shellyID: event.shellyID,
            deviceName: display,
            component,
            field: cfg.field,
            current: r.current,
            threshold,
            operator: cfg.operator
        }
    };
}

// The stored text is written once per transition, so it names its reading. A
// wildcard rule also names the component, since one rule covers several.
function readingText(
    verb: 'Fired' | 'Cleared',
    at: {
        cfg: ThresholdConfig;
        component: string;
        current: number;
        threshold: number;
    }
): string {
    const where = isWildcard(at.cfg.component) ? ` on ${at.component}` : '';
    const value = withUnit(at.current, at.cfg.field);
    const limit = withUnit(at.threshold, at.cfg.field);
    return `${verb} at ${value}${where} (limit ${limit})`;
}

function withUnit(value: number, field: string): string {
    const unit = fieldUnit(field);
    return unit ? `${value} ${unit}` : String(value);
}

// Back inside the limit → resolve. Unreadable → leave as-is, so a component
// that dropped off the status payload does not silently close its alert.
function clearComponent(
    event: {
        shellyID: string;
        status: Record<string, unknown>;
        device?: AbstractDevice;
    },
    rule: {id: number},
    cfg: ThresholdConfig,
    component: string
): ClearMatch | null {
    const threshold = resolveThreshold(cfg.thresholdRaw, event.device);
    if (threshold === null) return null;
    const r = readReading(event, {...cfg, component});
    if (!r) return null;
    const clearLimit =
        resolveThreshold(cfg.clearThresholdRaw, event.device) ?? threshold;
    if (evalOperator(cfg.operator, r.current, clearLimit)) return null;
    return {
        fingerprintV2: fieldFingerprintV2({
            ruleId: rule.id,
            subjectType: r.subject.type,
            subjectId: r.subject.id,
            component,
            field: cfg.field
        }),
        cleared: {
            current: r.current,
            threshold,
            message: readingText('Cleared', {
                cfg,
                component,
                current: r.current,
                threshold
            })
        }
    };
}

function configFor(rule: {
    kind: string;
    config: Record<string, unknown>;
}): ThresholdConfig | null {
    if (rule.kind !== KIND) return null;
    return readConfig(rule.config);
}

export const componentThresholdEvaluator: Evaluator = {
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],

    inputTypes(rule) {
        return componentRuleInputTypes(rule.config.component);
    },

    // Single-component path for direct callers (preview/tests); the engine fires
    // via matchAll. Wildcard is owned by matchAll — if both answered the same
    // event the rule would fire twice.
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
        return alertTargetComponents(
            cfg,
            event.status,
            event.device,
            event.promotedAway
        )
            .map((c) => matchComponent(event, rule, cfg, c))
            .filter((m): m is MatchResult => m !== null);
    },

    matchClear(event, rule) {
        if (event.kind !== 'device_status_changed') return null;
        const cfg = configFor(rule);
        if (!cfg || isWildcard(cfg.component)) return null;
        return clearComponent(event, rule, cfg, cfg.component);
    },

    matchClearAll(event, rule): readonly ClearMatch[] {
        if (event.kind !== 'device_status_changed') return [];
        const cfg = configFor(rule);
        if (!cfg) return [];
        return alertTargetComponents(
            cfg,
            event.status,
            event.device,
            event.promotedAway
        )
            .map((c) => clearComponent(event, rule, cfg, c))
            .filter((m): m is ClearMatch => m !== null);
    }
};
