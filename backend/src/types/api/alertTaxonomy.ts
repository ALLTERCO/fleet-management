// Alert taxonomy — the public vocabulary for the alert.* API: severities,
// states, kinds, families, device classes, scopes, and core record shapes.

/** Severity vocabulary. Coupled with SQL (keep in sync on change):
 *   - notifications/2002_alerting_foundation.sql:34-36 (CHECK constraint)
 *   - notifications/6048_fn_apply_group_severity_floor.sql:25 (v_levels rank) */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Total ordering for severity. Higher rank = more severe. Order must match
 *  the v_levels array in notifications/6048_fn_apply_group_severity_floor.sql. */
export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> =
    Object.freeze({info: 0, warning: 1, critical: 2});

/** Return the more severe of two severities (right-biased on ties). */
export function maxSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
    return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// Alert instance lifecycle. CHECK constraint in
// notifications/6934_alert_instance_evaluation_lifecycle.sql.
export const ALERT_STATES = [
    'pending',
    'active',
    'acknowledged',
    'recovering',
    'cleared_unack',
    'cleared_ack',
    'no_data',
    'evaluation_error',
    'resolved'
] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const ALERT_TRANSITION_ACTIONS = [
    'created',
    'pending',
    'triggered',
    'acknowledged',
    'unacknowledged',
    'silenced',
    'unsilenced',
    'recovering',
    'cleared_unack',
    'cleared_ack',
    'no_data',
    'evaluation_error',
    'resolved'
] as const;
export type AlertTransitionAction = (typeof ALERT_TRANSITION_ACTIONS)[number];

/** Rule kinds. Coupled with the alert_rule.kind CHECK constraint at
 *  notifications/6527_alert_kind_heartbeat.sql — add both together. */
export const ALERT_RULE_KINDS = [
    'device_offline',
    'device_back_online',
    'battery_below',
    'smoke_alarm',
    'flood_alarm',
    'motion_detected',
    'component_threshold',
    'component_state',
    'firmware_operation_failed',
    'backup_operation_failed',
    'automation_run_failed',
    'grafana_alert',
    'heartbeat',
    'energy_consumption_threshold',
    'rate_of_change',
    'stuck_sensor',
    'composite',
    'anomaly_band',
    'change_event',
    'device_event'
] as const;
export type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];

export type StoredAlertRuleKind =
    | AlertRuleKind
    | 'entity_threshold'
    | 'entity_state';

export function publicAlertRuleKind(kind: string): AlertRuleKind {
    if (kind === 'entity_threshold') return 'component_threshold';
    if (kind === 'entity_state') return 'component_state';
    return kind as AlertRuleKind;
}

export function storedAlertRuleKind(kind: AlertRuleKind): StoredAlertRuleKind {
    return kind;
}

// Three condition families + event + advanced (composite/anomaly land in Phase 7).
// CHECK constraint in notifications/6525_alert_rule_condition_family.sql.
export const ALERT_CONDITION_FAMILIES = [
    'threshold',
    'inactivity',
    'delta',
    'event',
    'composite',
    'anomaly'
] as const;
export type AlertConditionFamily = (typeof ALERT_CONDITION_FAMILIES)[number];

// HA-style device_class taxonomy. Drives default operators + units.
export const ALERT_DEVICE_CLASSES = [
    'temperature',
    'humidity',
    'power',
    'energy',
    'current',
    'voltage',
    'battery',
    'motion',
    'opening',
    'smoke',
    'gas',
    'carbon_monoxide',
    'moisture',
    'illuminance',
    'pressure',
    'co2',
    'tvoc',
    'signal_strength',
    'presence',
    'occupancy',
    'tamper',
    'vibration',
    'garage_door',
    'lock',
    'sound',
    'switch',
    'other'
] as const;
export type AlertDeviceClass = (typeof ALERT_DEVICE_CLASSES)[number];

// Component path prefix → device_class. Matches the Shelly Gen2 component
// naming (temperature:0, em:0, humidity:0, etc.).
const COMPONENT_PREFIX_TO_CLASS: Readonly<Record<string, AlertDeviceClass>> =
    Object.freeze({
        temperature: 'temperature',
        humidity: 'humidity',
        em: 'power',
        em1: 'power',
        pm1: 'power',
        switch: 'switch',
        relay: 'switch',
        light: 'switch',
        cover: 'opening',
        devicepower: 'battery',
        smoke: 'smoke',
        flood: 'moisture',
        moisture: 'moisture',
        gas: 'gas',
        carbon_monoxide: 'carbon_monoxide',
        illuminance: 'illuminance',
        lux: 'illuminance',
        pressure: 'pressure',
        co2: 'co2',
        tvoc: 'tvoc',
        contact: 'opening',
        input: 'opening',
        voltmeter: 'voltage',
        presence: 'presence',
        occupancy: 'occupancy',
        motion: 'motion',
        tamper: 'tamper',
        vibration: 'vibration',
        garage_door: 'garage_door',
        lock: 'lock',
        sound: 'sound'
    });

// Infer device_class from a Shelly component path (e.g. "temperature:0").
export function inferDeviceClass(component: string): AlertDeviceClass {
    const prefix = component.split(':')[0]?.toLowerCase() ?? '';
    return COMPONENT_PREFIX_TO_CLASS[prefix] ?? 'other';
}

// Maps each legacy kind to its (family, subkind) pair. Matches the
// backfill in 6525.
export const ALERT_KIND_TO_FAMILY: Readonly<
    Record<AlertRuleKind, {family: AlertConditionFamily; subkind: string}>
> = Object.freeze({
    device_offline: {family: 'inactivity', subkind: 'offline'},
    device_back_online: {family: 'event', subkind: 'device_back_online'},
    battery_below: {family: 'threshold', subkind: 'battery'},
    smoke_alarm: {family: 'event', subkind: 'smoke_alarm'},
    flood_alarm: {family: 'event', subkind: 'flood_alarm'},
    motion_detected: {family: 'event', subkind: 'motion_detected'},
    component_threshold: {family: 'threshold', subkind: 'custom'},
    component_state: {family: 'threshold', subkind: 'component_state'},
    firmware_operation_failed: {
        family: 'event',
        subkind: 'firmware_operation_failed'
    },
    backup_operation_failed: {
        family: 'event',
        subkind: 'backup_operation_failed'
    },
    automation_run_failed: {family: 'event', subkind: 'automation_run_failed'},
    grafana_alert: {family: 'event', subkind: 'grafana_alert'},
    heartbeat: {family: 'inactivity', subkind: 'heartbeat'},
    energy_consumption_threshold: {
        family: 'threshold',
        subkind: 'energy_consumption'
    },
    rate_of_change: {family: 'delta', subkind: 'rate_of_change'},
    stuck_sensor: {family: 'delta', subkind: 'stuck_sensor'},
    composite: {family: 'composite', subkind: 'composite'},
    anomaly_band: {family: 'anomaly', subkind: 'anomaly_band'},
    change_event: {family: 'event', subkind: 'change_event'},
    device_event: {family: 'event', subkind: 'device_event'}
});

export const ALERT_SCOPE_TYPES = [
    'device',
    'component',
    'group',
    'location',
    'tag'
] as const;
export type AlertScopeType = (typeof ALERT_SCOPE_TYPES)[number];

export type StoredAlertScopeType = AlertScopeType | 'entity';

export function publicAlertScopeType(type: string): AlertScopeType {
    return type === 'entity' ? 'component' : (type as AlertScopeType);
}

export function storedAlertScopeType(
    type: AlertScopeType
): StoredAlertScopeType {
    return type === 'component' ? 'entity' : type;
}

export interface SourceRef {
    organizationId: string;
    subjectType: AlertScopeType;
    subjectId: string;
}
export type AlertSourceRef = SourceRef;

export interface ActorRef {
    userId: string;
    displayName?: string | null;
}
export type AlertActorRef = ActorRef;

export interface ScopeSelector {
    deviceIds?: string[];
    componentIds?: string[];
    groupIds?: number[];
    locationIds?: number[];
    tagIds?: number[];
}

export interface AlertRule {
    id: number;
    organizationId: string;
    name: string;
    kind: AlertRuleKind;
    enabled: boolean;
    severity: AlertSeverity;
    scope: ScopeSelector;
    dedupeWindowSec: number;
    cooldownSec: number;
    destinationGroupIds: number[];
    /** Channels the rule notifies directly. */
    destinationChannelIds: number[];
    /** digest = inbox routed through digest queue, overriding per-user pref. */
    deliveryMode: 'instant' | 'digest';
    /** Digest window in minutes. null = use platform default. */
    digestWindowMinutes: number | null;
    ownerUserId: string | null;
    summaryTemplate: string | null;
    messageTemplate: string | null;
    autoResolve: boolean;
    config: Record<string, unknown>;
    /** Per-rule override of FM_ALERT_GROUP_BY. null = use env default. */
    groupBy: readonly string[] | null;
    /** Optional URL to the org's runbook for this rule. null = none. */
    runbookUrl: string | null;
    /** Reusable message template this rule renders from. null = inline wording. */
    templateId: number | null;
    /** Most recent instance trigger for this rule. null = never fired. */
    lastFiredAt: string | null;
    createdAt: string;
    updatedAt: string | null;
}

export interface AlertInstance {
    id: number;
    organizationId: string;
    ruleId: number;
    ruleKind: AlertRuleKind;
    state: AlertState;
    severity: AlertSeverity;
    source: AlertSourceRef;
    title: string;
    message: string;
    fingerprint: string;
    activeSince: string;
    lastTriggeredAt: string;
    acknowledgedAt: string | null;
    acknowledgedBy: AlertActorRef | null;
    /** Operator note recorded with the ack. */
    ackComment: string | null;
    resolvedAt: string | null;
    silencedUntil: string | null;
    silenceReason: string | null;
    counts: {
        notificationsCreated: number;
        deliveryJobsCreated: number;
    };
    context: Record<string, unknown>;
}

export interface AlertTransition {
    at: string;
    action: AlertTransitionAction;
    actor: AlertActorRef | null;
    data: Record<string, unknown>;
}

// Free-form note attached to an alert instance during incident response.
export interface AlertAnnotation {
    id: number;
    alertInstanceId: number;
    organizationId: string;
    author: AlertActorRef;
    body: string;
    createdAt: string;
    editedAt: string | null;
}

export interface AlertRuleKindDescriptor {
    key: AlertRuleKind;
    label: string;
    /** Severity the rule builder auto-fills unless the user overrides it. */
    defaultSeverity: AlertSeverity;
    /** How the condition becomes true: future event, current state, absence, or history window. */
    evaluationMode: 'event' | 'state' | 'absence' | 'window' | 'composite';
    /** True when create/enable/update must evaluate the current truth. */
    initialEvaluation: boolean;
    /** Primary source used for evaluation. */
    dataSource:
        | 'runtime_event'
        | 'latest_status'
        | 'presence_store'
        | 'history_store'
        | 'mixed';
    /** Whether config.forSec/offlineForSec is meaningful for this kind. */
    supportsForSec: boolean;
    /** How active alerts clear. */
    clearBehavior:
        | 'manual'
        | 'recovery_event'
        | 'state_recovery'
        | 'absence_recovery'
        | 'window_recovery'
        | 'composite_recovery';
    /** Whether event rules replay old durable events or only watch the future. */
    eventReplayPolicy: 'future_only' | 'durable_replay' | 'not_applicable';
    phaseAvailable: 1;
    supportsManualResolve: boolean;
    supportsAutoResolve: boolean;
    supportedScopeTypes: AlertScopeType[];
    configSchema: Record<string, unknown>;
}
