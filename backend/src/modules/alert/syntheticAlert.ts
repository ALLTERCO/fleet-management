/**
 * Synthetic alert fixture builder.
 *
 * Builds well-formed (rule, event, match) triples for use by every test
 * tier and by the future `Dev.FireSyntheticAlert` admin RPC. Pure
 * functions — no DB, no network, no side effects.
 *
 * Why this exists: Phase 1 of the alert + notification redesign adds a
 * schema↔evaluator contract test that takes the minimum-valid config
 * for every rule kind and feeds it through the evaluator. Without a
 * generator, every test file rebuilds the same rule/event scaffolding
 * by hand and the documented drifts hide behind boilerplate.
 */

import type AbstractDevice from '../../model/AbstractDevice';
import type {JsonSchema} from '../../types/api/_schema';
import {
    ALERT_KIND_TO_FAMILY,
    ALERT_RULE_KIND_CONFIG_SCHEMAS,
    type AlertRuleKind,
    type AlertSeverity,
    type ScopeSelector
} from '../../types/api/alert';
import {getEvaluator} from './evaluators';
import type {LoadedAlertRule, MatchResult, NormalizedEvent} from './types';

// ─── Public types ────────────────────────────────────────────────

export interface BuildRuleInput {
    kind: AlertRuleKind;
    /** Defaults to a schema-compliant minimum for the given kind. */
    config?: Record<string, unknown>;
    /** Defaults to {}: matches every device in the organization. */
    scope?: ScopeSelector;
    /** Defaults to 'warning'. */
    severity?: AlertSeverity;
    /** Field-level overrides applied after defaults. */
    overrides?: Partial<LoadedAlertRule>;
}

export type BuildEventInput =
    | {
          kind: 'device_offline' | 'device_online';
          shellyID: string;
          organizationId?: string;
          device?: DeviceStub;
      }
    | {
          kind: 'device_status_changed';
          shellyID: string;
          organizationId?: string;
          status: Record<string, unknown>;
          device?: DeviceStub;
      }
    | {
          kind: 'device_event_received';
          shellyID: string;
          organizationId?: string;
          componentType: string;
          componentKey?: string;
          event: string;
          ts?: number | null;
          attrs?: Record<string, unknown>;
          device?: DeviceStub;
      }
    | {
          kind: 'firmware_operation_failed' | 'backup_operation_failed';
          shellyID: string;
          organizationId?: string;
          errorMessage?: string;
      }
    | {
          kind: 'automation_run_failed';
          organizationId?: string;
          automationId: number;
          automationName: string;
          errorMessage?: string;
      }
    | {
          kind: 'grafana_alert';
          organizationId?: string;
          status: 'firing' | 'resolved';
          fingerprint: string;
          alertName: string;
          summary: string;
          labels: Record<string, string>;
          annotations: Record<string, string>;
      };

export interface BuildSyntheticAlertInput {
    kind: AlertRuleKind;
    shellyID?: string;
    config?: Record<string, unknown>;
    scope?: ScopeSelector;
    severity?: AlertSeverity;
    /** If omitted, an event of the rule's trigger kind is synthesized. */
    event?: BuildEventInput;
    /** Attach a device stub to the event for evaluators that need it. */
    device?: DeviceStub;
    /** Rule field overrides. */
    ruleOverrides?: Partial<LoadedAlertRule>;
}

export interface SyntheticAlert {
    rule: LoadedAlertRule;
    event: NormalizedEvent;
    /** Null when the event does not match the rule (e.g. wrong kind, below threshold). */
    match: MatchResult | null;
}

/**
 * Minimal device shape the evaluators actually read at runtime. Cast to
 * AbstractDevice at the event boundary; fields the evaluators don't read
 * (transport, RPC machinery, repository handles) are intentionally
 * absent. Cheaper than constructing a real device for a fixture.
 */
export type DeviceStub = {
    shellyID: string;
    status: Record<string, unknown>;
    info?: {name?: string};
    entities?: readonly unknown[];
};

// ─── buildRule ───────────────────────────────────────────────────

const DEFAULT_ORG_ID = 'org-synth';

export function buildRule(input: BuildRuleInput): LoadedAlertRule {
    const config = input.config ?? minimalValidConfigFor(input.kind);
    const familyMapping = ALERT_KIND_TO_FAMILY[input.kind];
    const base: LoadedAlertRule = {
        id: 1,
        organizationId: DEFAULT_ORG_ID,
        name: `synthetic ${input.kind}`,
        templateId: null,
        kind: input.kind,
        conditionFamily: familyMapping.family,
        conditionSubkind: familyMapping.subkind,
        severity: input.severity ?? 'warning',
        scope: input.scope ?? {},
        dedupeWindowSec: 0,
        cooldownSec: 0,
        ownerUserId: null,
        summaryTemplate: null,
        messageTemplate: null,
        autoResolve: true,
        config,
        destinationGroupIds: [],
        destinationChannelIds: [],
        groupBy: null,
        deliveryMode: 'instant',
        digestWindowMinutes: null,
        runbookUrl: null,
        labelsTemplate: {}
    };
    return input.overrides ? {...base, ...input.overrides} : base;
}

// ─── buildEvent ──────────────────────────────────────────────────

const DEFAULT_SHELLY_ID = 'shelly-synth-1';

export function buildEvent(input: BuildEventInput): NormalizedEvent {
    const organizationId = input.organizationId ?? DEFAULT_ORG_ID;
    switch (input.kind) {
        case 'device_offline':
        case 'device_online':
            return {
                kind: input.kind,
                organizationId,
                shellyID: input.shellyID,
                device: input.device as AbstractDevice | undefined
            };
        case 'device_status_changed':
            return {
                kind: 'device_status_changed',
                organizationId,
                shellyID: input.shellyID,
                status: input.status,
                device: input.device as AbstractDevice | undefined
            };
        case 'device_event_received':
            return {
                kind: 'device_event_received',
                organizationId,
                shellyID: input.shellyID,
                componentType: input.componentType,
                componentKey: input.componentKey ?? `${input.componentType}:0`,
                event: input.event,
                ts: input.ts ?? null,
                attrs: input.attrs ?? {},
                device: input.device as AbstractDevice | undefined
            };
        case 'firmware_operation_failed':
        case 'backup_operation_failed':
            return {
                kind: input.kind,
                organizationId,
                shellyID: input.shellyID,
                errorMessage: input.errorMessage ?? 'synthetic failure'
            };
        case 'automation_run_failed':
            return {
                kind: 'automation_run_failed',
                organizationId,
                automationId: input.automationId,
                automationName: input.automationName,
                errorMessage: input.errorMessage ?? 'synthetic failure'
            };
        case 'grafana_alert':
            return {
                kind: 'grafana_alert',
                organizationId,
                status: input.status,
                fingerprint: input.fingerprint,
                alertName: input.alertName,
                summary: input.summary,
                labels: input.labels,
                annotations: input.annotations
            };
    }
}

// ─── minimalValidConfigFor ───────────────────────────────────────

/**
 * Returns a config object satisfying every `required` field in the
 * kind's JSON schema. For optional fields, omitted. For required
 * numerics, returns a value in the [minimum, maximum] window. For
 * required enums, returns the first allowed value.
 *
 * This is the SOURCE OF TRUTH the Phase 1 contract test feeds into
 * each evaluator. If schema and evaluator disagree on field names,
 * the match returns null and the contract test fails.
 */
export function minimalValidConfigFor(
    kind: AlertRuleKind
): Record<string, unknown> {
    const schema = ALERT_RULE_KIND_CONFIG_SCHEMAS[kind];
    return minimalFromSchema(schema);
}

function minimalFromSchema(schema: JsonSchema): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const required = schema.required ?? [];
    const properties = schema.properties ?? {};
    for (const field of required) {
        const propertySchema = properties[field];
        if (!propertySchema) continue;
        result[field] = minimalValueForProperty(propertySchema);
    }
    return result;
}

function minimalValueForProperty(schema: JsonSchema): unknown {
    if (schema.enum && schema.enum.length > 0) return schema.enum[0];
    if (schema.const !== undefined) return schema.const;
    if (schema.default !== undefined) return schema.default;
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    switch (type) {
        case 'number':
        case 'integer':
            return schema.minimum ?? 0;
        case 'string':
            return 'synth';
        case 'boolean':
            return false;
        case 'array':
            return [];
        case 'object':
            return schema.properties ? minimalFromSchema(schema) : {};
        case 'null':
            return null;
        default:
            return null;
    }
}

// ─── buildSyntheticAlert ─────────────────────────────────────────

const RULE_KIND_TO_TRIGGER_EVENT: Record<
    AlertRuleKind,
    NormalizedEvent['kind']
> = {
    device_offline: 'device_offline',
    device_back_online: 'device_online',
    battery_below: 'device_status_changed',
    smoke_alarm: 'device_status_changed',
    flood_alarm: 'device_status_changed',
    motion_detected: 'device_status_changed',
    component_threshold: 'device_status_changed',
    component_state: 'device_status_changed',
    firmware_operation_failed: 'firmware_operation_failed',
    backup_operation_failed: 'backup_operation_failed',
    automation_run_failed: 'automation_run_failed',
    grafana_alert: 'grafana_alert',
    // heartbeat fires via engine periodic sweep, not a direct event;
    // we map to the clear-signal event so synthetic builders work.
    heartbeat: 'device_status_changed',
    energy_consumption_threshold: 'device_status_changed',
    rate_of_change: 'device_status_changed',
    stuck_sensor: 'device_status_changed',
    // Phase 7 sweep-driven kinds map to the same clear-signal event.
    composite: 'device_status_changed',
    anomaly_band: 'device_status_changed',
    change_event: 'device_status_changed',
    device_event: 'device_event_received'
};

export function buildSyntheticAlert(
    input: BuildSyntheticAlertInput
): SyntheticAlert {
    const shellyID = input.shellyID ?? DEFAULT_SHELLY_ID;
    const rule = buildRule({
        kind: input.kind,
        config: input.config,
        scope: input.scope,
        severity: input.severity,
        overrides: input.ruleOverrides
    });
    const eventInput = input.event
        ? withDeviceStub(input.event, input.device, shellyID)
        : defaultEventInput(input.kind, shellyID, input.device, rule.config);
    const event = buildEvent(eventInput);
    const evaluator = getEvaluator(input.kind);
    const match = evaluator ? evaluator.match(event, rule) : null;
    return {rule, event, match};
}

/**
 * Evaluators that walk channels via `collectSignals(event.device)` need
 * a device on the event. If the caller provided status but no device,
 * synthesize a minimal device stub carrying that status so the evaluator
 * has something to read.
 */
function withDeviceStub(
    eventInput: BuildEventInput,
    extraDevice: DeviceStub | undefined,
    shellyID: string
): BuildEventInput {
    if ('device' in eventInput && eventInput.device) return eventInput;
    if (extraDevice) {
        return {...eventInput, device: extraDevice} as BuildEventInput;
    }
    if (eventInput.kind === 'device_status_changed') {
        return {
            ...eventInput,
            device: {
                shellyID: eventInput.shellyID ?? shellyID,
                status: eventInput.status,
                entities: []
            }
        };
    }
    return eventInput;
}

function defaultEventInput(
    kind: AlertRuleKind,
    shellyID: string,
    device: DeviceStub | undefined,
    ruleConfig: Record<string, unknown>
): BuildEventInput {
    const triggerKind = RULE_KIND_TO_TRIGGER_EVENT[kind];
    switch (triggerKind) {
        case 'device_offline':
        case 'device_online':
            return {kind: triggerKind, shellyID, device};
        case 'device_status_changed':
            return {
                kind: 'device_status_changed',
                shellyID,
                status: device?.status ?? {},
                device
            };
        case 'device_event_received':
            return defaultDeviceEventInput(shellyID, device, ruleConfig);
        case 'firmware_operation_failed':
        case 'backup_operation_failed':
            return {kind: triggerKind, shellyID};
        case 'automation_run_failed':
            return {
                kind: 'automation_run_failed',
                automationId: 1,
                automationName: 'synthetic automation'
            };
        case 'grafana_alert':
            return {
                kind: 'grafana_alert',
                status: 'firing',
                fingerprint: 'synthetic-fingerprint',
                alertName: 'synthetic grafana alert',
                summary: 'Synthetic Grafana alert for preview',
                labels: {},
                annotations: {}
            };
    }
}

// Pull (componentType, event) from rule.config so the synthetic match
// exercises the happy path instead of a contradictory pair.
function defaultDeviceEventInput(
    shellyID: string,
    device: DeviceStub | undefined,
    ruleConfig: Record<string, unknown>
): BuildEventInput {
    const componentType =
        typeof ruleConfig.componentType === 'string'
            ? ruleConfig.componentType
            : 'synth';
    const event =
        typeof ruleConfig.event === 'string' ? ruleConfig.event : 'synth_event';
    return {
        kind: 'device_event_received',
        shellyID,
        componentType,
        componentKey: `${componentType}:0`,
        event,
        ts: 0,
        attrs: {},
        device
    };
}
