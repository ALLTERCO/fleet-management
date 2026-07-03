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
import {resolveThreshold} from '../perDeviceAttr';
import type {Evaluator, MatchResult} from '../types';
import {deviceDisplayName, readField, readNumber} from './shared';

const KIND = 'component_threshold';

type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

interface ThresholdConfig {
    component: string;
    field: string;
    operator: Operator;
    // Raw values: number OR "${attr}" template; resolved per-fire.
    thresholdRaw: number | string;
    clearThresholdRaw?: number | string;
    severity?: AlertSeverity;
}

function readConfig(cfg: Record<string, unknown>): ThresholdConfig | null {
    const {component, field, operator, threshold, clearThreshold, severity} =
        cfg;
    if (typeof component !== 'string' || !component) return null;
    if (typeof field !== 'string' || !field) return null;
    if (typeof threshold !== 'number' && typeof threshold !== 'string') {
        return null;
    }
    if (!isOperator(operator)) return null;
    return {
        component,
        field,
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

/** Resolve the reading: native status path OR entity id path. */
function readReading(
    event: {status: Record<string, unknown>; device?: AbstractDevice},
    cfg: ThresholdConfig
): {current: number; subject: {type: 'device' | 'entity'; id: string}} | null {
    const targetPrefix = cfg.component.startsWith(COMPONENT_TARGET_PREFIX)
        ? COMPONENT_TARGET_PREFIX
        : cfg.component.startsWith(LEGACY_ENTITY_TARGET_PREFIX)
          ? LEGACY_ENTITY_TARGET_PREFIX
          : null;
    if (targetPrefix) {
        if (!event.device) return null;
        const id = cfg.component.slice(targetPrefix.length);
        const entity = (event.device.entities ?? []).find((e) => e.id === id);
        if (!entity) return null;
        // Entity readings live on the backing status component, not on the entity object.
        const status = event.device.status as Record<string, unknown>;
        const backing =
            entity.type === 'bthomesensor'
                ? status?.[`bthomesensor:${entity.properties.id}`]
                : status?.[entity.id];
        if (!backing) return null;
        const current = readNumber(backing, cfg.field);
        if (current === null) return null;
        return {current, subject: {type: 'entity', id}};
    }
    const component = readField(event.status, cfg.component);
    if (!component) return null;
    const current = readNumber(component, cfg.field);
    if (current === null) return null;
    const gwId = event.device?.shellyID;
    if (!gwId) return null;
    return {current, subject: {type: 'device', id: gwId}};
}

export const componentThresholdEvaluator: Evaluator = {
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],

    match(event, rule): MatchResult | null {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_status_changed') return null;
        const cfg = readConfig(rule.config);
        if (!cfg) return null;
        const threshold = resolveThreshold(cfg.thresholdRaw, event.device);
        if (threshold === null) return null;
        const r = readReading(event, cfg);
        if (!r) return null;
        if (!evalOperator(cfg.operator, r.current, threshold)) return null;

        const display =
            r.subject.type === 'entity'
                ? `${cfg.component} ${r.subject.id}`
                : deviceDisplayName(event.device) || event.shellyID;
        return {
            fingerprintV2: fieldFingerprintV2({
                ruleId: rule.id,
                subjectType: r.subject.type,
                subjectId: r.subject.id,
                component: cfg.component,
                field: cfg.field
            }),
            title: `${display} threshold breach`,
            message: `${cfg.component}.${cfg.field} is ${r.current} ${cfg.operator} ${threshold}.`,
            severity: cfg.severity,
            subject: r.subject,
            context: {
                shellyID: event.shellyID,
                component: cfg.component,
                field: cfg.field,
                current: r.current,
                threshold,
                operator: cfg.operator
            }
        };
    },

    matchClear(event, rule) {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_status_changed') return null;
        const cfg = readConfig(rule.config);
        if (!cfg) return null;
        const threshold = resolveThreshold(cfg.thresholdRaw, event.device);
        if (threshold === null) return null;
        const r = readReading(event, cfg);
        if (!r) return null;
        const clearLimit =
            resolveThreshold(cfg.clearThresholdRaw, event.device) ?? threshold;
        if (evalOperator(cfg.operator, r.current, clearLimit)) return null;
        return {
            fingerprintV2: fieldFingerprintV2({
                ruleId: rule.id,
                subjectType: r.subject.type,
                subjectId: r.subject.id,
                component: cfg.component,
                field: cfg.field
            })
        };
    }
};
