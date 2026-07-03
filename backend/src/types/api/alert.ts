/** Public API types for the `alert.*` namespace. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import {type JsonSchema, NON_NEGATIVE_INT4_SCHEMA} from './_schema';
import {MAX_BATCH_SIZE, NAME_SCHEMA, ORG_ID_SCHEMA} from './_shared';

export * from './alertTaxonomy';

import {
    ALERT_DEVICE_CLASSES,
    ALERT_RULE_KINDS,
    ALERT_SCOPE_TYPES,
    ALERT_SEVERITIES,
    ALERT_STATES,
    ALERT_TRANSITION_ACTIONS,
    type AlertDeviceClass,
    type AlertRuleKind,
    type AlertRuleKindDescriptor,
    type AlertSeverity,
    type AlertSourceRef,
    type AlertTransitionAction,
    type ScopeSelector,
    type SourceRef
} from './alertTaxonomy';

const EMPTY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

const QUERY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120
};

const LIMIT_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1,
    maximum: 1000,
    default: 200
};

const OFFSET_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 0,
    default: 0
};

const SUBJECT_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 255
};

const STRING_ARRAY_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'string', minLength: 1, maxLength: 255},
    maxItems: MAX_BATCH_SIZE
};

const INT_ARRAY_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'integer', minimum: 1},
    maxItems: MAX_BATCH_SIZE
};

const OPTIONAL_TEXT_SCHEMA: JsonSchema = {
    type: ['string', 'null']
};

const OPTIONAL_USER_ID_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    minLength: 1,
    maxLength: 255
};

export const ALERT_KIND_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...ALERT_RULE_KINDS]
};

export const ALERT_SEVERITY_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...ALERT_SEVERITIES]
};

export const ALERT_STATE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...ALERT_STATES]
};

export const ALERT_TRANSITION_ACTION_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...ALERT_TRANSITION_ACTIONS]
};

const ALERT_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    maxProperties: 100,
    maxBytes: 64 * 1024
};

const DESTINATION_GROUP_IDS_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'integer', minimum: 1},
    maxItems: MAX_BATCH_SIZE
};

// Directly-targeted channels. Same shape as groups;
// named separately so each field reads honestly.
const DESTINATION_CHANNEL_IDS_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'integer', minimum: 1},
    maxItems: MAX_BATCH_SIZE
};

// Per-rule override of FM_ALERT_GROUP_BY. Allowed label names mirror the
// env default set (add new entries here if the grouper learns new labels).
export const ALERT_GROUP_BY_LABELS = [
    'organization_id',
    'rule_id',
    'severity',
    'kind',
    'subject_type'
] as const;
const GROUP_BY_SCHEMA: JsonSchema = {
    type: ['array', 'null'],
    items: {type: 'string', enum: [...ALERT_GROUP_BY_LABELS]},
    minItems: 1,
    maxItems: 8,
    description:
        'Per-rule override of FM_ALERT_GROUP_BY. null = use env default.'
};

export const ALERT_SCOPE_SELECTOR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        deviceIds: STRING_ARRAY_SCHEMA,
        componentIds: STRING_ARRAY_SCHEMA,
        groupIds: INT_ARRAY_SCHEMA,
        locationIds: INT_ARRAY_SCHEMA,
        tagIds: INT_ARRAY_SCHEMA
    }
};

export const ALERT_SOURCE_REF_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['organizationId', 'subjectType', 'subjectId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        subjectType: {type: 'string', enum: [...ALERT_SCOPE_TYPES]},
        subjectId: {type: 'string', minLength: 1, maxLength: 255}
    }
};

export const ALERT_ACTOR_REF_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['userId'],
    properties: {
        userId: {type: 'string', minLength: 1, maxLength: 255},
        displayName: {type: ['string', 'null'], maxLength: 255}
    }
};

const OPTIONAL_ACTOR_REF_SCHEMA: JsonSchema = {
    anyOf: [ALERT_ACTOR_REF_SCHEMA, {type: 'null'}]
};

const DEVICE_OFFLINE_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        offlineForSec: {
            type: 'integer',
            minimum: 30,
            maximum: 86400,
            default: 300,
            description: 'How long the subject must stay offline before firing.'
        }
    }
};

const BATTERY_BELOW_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['thresholdPct'],
    properties: {
        thresholdPct: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Trigger when battery percent drops below this value.'
        },
        clearThresholdPct: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description:
                'Optional asymmetric hysteresis. Auto-resolve only when ' +
                'percent rises above this value. Must be >= thresholdPct.'
        }
    }
};

const CLEAR_TIMEOUT_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        clearTimeoutSec: {
            type: 'integer',
            minimum: 1,
            maximum: 86400,
            default: 300,
            description:
                'Auto-resolve after this quiet period once the event stops firing.'
        }
    }
};

const HEARTBEAT_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['expectedIntervalSec'],
    properties: {
        expectedIntervalSec: {
            type: 'integer',
            minimum: 30,
            maximum: 86400,
            description:
                'Fire if no telemetry has arrived from the device for ' +
                'this long. Deadman / dead-man-switch pattern.'
        }
    }
};

const RATE_OF_CHANGE_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field', 'deltaValue', 'windowSec'],
    properties: {
        component: {type: 'string', maxLength: 120},
        field: {type: 'string', maxLength: 120},
        deltaValue: {type: 'number'},
        windowSec: {type: 'integer', minimum: 30, maximum: 86400}
    }
};

const ENERGY_CONSUMPTION_THRESHOLD_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['windowSec', 'operator', 'thresholdKWh'],
    properties: {
        windowSec: {
            type: 'integer',
            minimum: 300,
            maximum: 31 * 24 * 60 * 60,
            description:
                'Look-back window in seconds. The rule sums persisted total_act_energy over this window.'
        },
        operator: {
            type: 'string',
            enum: ['gt', 'gte', 'lt', 'lte']
        },
        thresholdKWh: {
            type: 'number',
            minimum: 0,
            description: 'Consumption threshold in kWh for the window.'
        },
        clearThresholdKWh: {
            type: 'number',
            minimum: 0,
            description:
                'Optional hysteresis threshold in kWh. Defaults to thresholdKWh.'
        },
        minSamples: {
            type: 'integer',
            minimum: 1,
            maximum: 100000,
            description:
                'Optional minimum rollup samples required before evaluating.'
        }
    }
};

const STUCK_SENSOR_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field', 'notChangedForSec'],
    properties: {
        component: {type: 'string', maxLength: 120},
        field: {type: 'string', maxLength: 120},
        notChangedForSec: {type: 'integer', minimum: 30, maximum: 86400}
    }
};

const COMPONENT_THRESHOLD_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field', 'operator', 'threshold'],
    properties: {
        component: {
            type: 'string',
            maxLength: 120,
            description:
                'Status component path, or logical sensor target for composed/BLU sensors (e.g. "temperature:0", "em:0", or "component:<id>").'
        },
        field: {
            type: 'string',
            maxLength: 120,
            description:
                'Status field key (e.g. "tC", "voltage", "value"; BLU sensor targets usually use "value").'
        },
        operator: {
            type: 'string',
            enum: ['lt', 'lte', 'gt', 'gte', 'eq', 'neq']
        },
        threshold: {
            type: ['number', 'string'],
            // Literal $-brace syntax shown to API users — split so biome
            // doesn't flag it as a misplaced template literal.
            description:
                'Numeric value, or "$' +
                '{attrName}" to dereference an attribute ' +
                'on the firing device (e.g. $' +
                '{calibratedMax}).'
        },
        clearThreshold: {
            type: ['number', 'string'],
            description:
                'Optional asymmetric hysteresis. Same units / dereference ' +
                'semantics as threshold.'
        },
        severity: {
            type: 'string',
            enum: ['info', 'warning', 'critical'],
            description:
                'Optional per-match severity override; defaults to rule.severity.'
        },
        forSec: {
            type: 'integer',
            minimum: 1,
            maximum: 86400,
            description:
                'Fire only after the threshold has held continuously for this many seconds. Omit to fire immediately.'
        }
    }
};

// Discrete-state condition: a status field equals a target state (on/off,
// open/closed, an enum). The boolean/enum sibling of component_threshold.
const COMPONENT_STATE_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field', 'equals'],
    properties: {
        component: {
            type: 'string',
            maxLength: 120,
            description:
                'Status component path, or logical sensor target for composed/BLU sensors (e.g. "switch:0", "cover:0", or "component:<id>").'
        },
        field: {
            type: 'string',
            maxLength: 120,
            description:
                'Status field key (e.g. "output", "state", "value"; BLU sensor targets usually use "value").'
        },
        equals: {
            type: ['boolean', 'string', 'number'],
            description:
                'The state that fires the rule, e.g. true (relay on), "open" (cover), false.'
        },
        severity: {
            type: 'string',
            enum: ['info', 'warning', 'critical'],
            description:
                'Optional per-match severity override; defaults to rule.severity.'
        },
        forSec: {
            type: 'integer',
            minimum: 1,
            maximum: 86400,
            description:
                'Fire only after the state has held continuously for this many seconds (sustained state). Omit to fire immediately.'
        }
    }
};

const EMPTY_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

// Phase 7: composite rule child expression — leaf or AND/OR/NOT node.
// `kind === 'leaf'` references another rule by id; the engine resolves
// each leaf to its current matched state before evaluating the tree.
const COMPOSITE_CHILD_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind'],
    properties: {
        kind: {type: 'string', enum: ['leaf', 'node']},
        // leaf-only:
        ruleId: {type: 'integer', minimum: 1},
        // node-only:
        op: {type: 'string', enum: ['and', 'or', 'not']},
        children: {
            type: 'array',
            items: {type: 'object'},
            maxItems: 16
        },
        windowSeconds: {type: 'integer', minimum: 1, maximum: 86400}
    }
};

const COMPOSITE_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tree'],
    properties: {
        tree: COMPOSITE_CHILD_SCHEMA,
        autoResolveSec: {
            type: 'integer',
            minimum: 1,
            maximum: 86400,
            description:
                'Auto-resolve after this quiet period once the tree stops matching.'
        }
    }
};

const ANOMALY_BAND_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field', 'k', 'windowSamples'],
    properties: {
        component: {type: 'string', maxLength: 120},
        field: {type: 'string', maxLength: 120},
        k: {
            type: 'number',
            minimum: 0.5,
            maximum: 10,
            description: 'Band width in stddev units (mean ± k·σ).'
        },
        windowSamples: {
            type: 'integer',
            minimum: 12,
            maximum: 10_000,
            description: 'Rolling baseline window length.'
        },
        minSamples: {
            type: 'integer',
            minimum: 12,
            maximum: 10_000,
            description: 'Minimum baseline samples before alerting.'
        },
        minStdDev: {
            type: 'number',
            minimum: 0,
            description:
                'Floor on stddev to suppress flat-line false positives.'
        }
    }
};

const CHANGE_EVENT_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field'],
    properties: {
        component: {type: 'string', maxLength: 120},
        field: {type: 'string', maxLength: 120},
        fromValue: {
            type: 'array',
            items: {type: ['string', 'number', 'boolean']},
            maxItems: 32
        },
        toValue: {
            type: 'array',
            items: {type: ['string', 'number', 'boolean']},
            maxItems: 32
        },
        anyChange: {type: 'boolean'}
    }
};

// `componentType` is the prefix ("em") so one rule matches every
// instance ("em:0", "em:1"). Optional `componentKey` pins to one instance
// ("bthomedevice:200") — target a specific remote. `predicate` narrows by
// payload attrs (e.g. {idx: 2} for one button of a multi-button remote).
const DEVICE_EVENT_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['componentType', 'event'],
    properties: {
        componentType: {type: 'string', minLength: 1, maxLength: 60},
        componentKey: {type: 'string', minLength: 1, maxLength: 60},
        event: {type: 'string', minLength: 1, maxLength: 120},
        predicate: {
            type: 'object',
            additionalProperties: {
                type: ['string', 'number', 'boolean']
            },
            maxProperties: 16
        }
    }
};

export const ALERT_RULE_KIND_CONFIG_SCHEMAS: Record<AlertRuleKind, JsonSchema> =
    {
        device_offline: DEVICE_OFFLINE_CONFIG_SCHEMA,
        device_back_online: EMPTY_CONFIG_SCHEMA,
        battery_below: BATTERY_BELOW_CONFIG_SCHEMA,
        smoke_alarm: EMPTY_CONFIG_SCHEMA,
        flood_alarm: EMPTY_CONFIG_SCHEMA,
        motion_detected: CLEAR_TIMEOUT_CONFIG_SCHEMA,
        component_threshold: COMPONENT_THRESHOLD_CONFIG_SCHEMA,
        component_state: COMPONENT_STATE_CONFIG_SCHEMA,
        firmware_operation_failed: EMPTY_CONFIG_SCHEMA,
        backup_operation_failed: EMPTY_CONFIG_SCHEMA,
        automation_run_failed: EMPTY_CONFIG_SCHEMA,
        grafana_alert: EMPTY_CONFIG_SCHEMA,
        heartbeat: HEARTBEAT_CONFIG_SCHEMA,
        energy_consumption_threshold:
            ENERGY_CONSUMPTION_THRESHOLD_CONFIG_SCHEMA,
        rate_of_change: RATE_OF_CHANGE_CONFIG_SCHEMA,
        stuck_sensor: STUCK_SENSOR_CONFIG_SCHEMA,
        composite: COMPOSITE_CONFIG_SCHEMA,
        anomaly_band: ANOMALY_BAND_CONFIG_SCHEMA,
        change_event: CHANGE_EVENT_CONFIG_SCHEMA,
        device_event: DEVICE_EVENT_CONFIG_SCHEMA
    };

const ALERT_RULE_KIND_DESCRIPTOR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'key',
        'label',
        'defaultSeverity',
        'evaluationMode',
        'initialEvaluation',
        'dataSource',
        'supportsForSec',
        'clearBehavior',
        'eventReplayPolicy',
        'phaseAvailable',
        'supportsManualResolve',
        'supportsAutoResolve',
        'supportedScopeTypes',
        'configSchema'
    ],
    properties: {
        key: {type: 'string', enum: [...ALERT_RULE_KINDS]},
        label: {type: 'string'},
        defaultSeverity: {type: 'string', enum: [...ALERT_SEVERITIES]},
        evaluationMode: {
            type: 'string',
            enum: ['event', 'state', 'absence', 'window', 'composite']
        },
        initialEvaluation: {type: 'boolean'},
        dataSource: {
            type: 'string',
            enum: [
                'runtime_event',
                'latest_status',
                'presence_store',
                'history_store',
                'mixed'
            ]
        },
        supportsForSec: {type: 'boolean'},
        clearBehavior: {
            type: 'string',
            enum: [
                'manual',
                'recovery_event',
                'state_recovery',
                'absence_recovery',
                'window_recovery',
                'composite_recovery'
            ]
        },
        eventReplayPolicy: {
            type: 'string',
            enum: ['future_only', 'durable_replay', 'not_applicable']
        },
        phaseAvailable: {type: 'integer', enum: [1]},
        supportsManualResolve: {type: 'boolean'},
        supportsAutoResolve: {type: 'boolean'},
        supportedScopeTypes: {
            type: 'array',
            items: {type: 'string', enum: [...ALERT_SCOPE_TYPES]}
        },
        configSchema: {type: 'object'}
    }
};

export const ALERT_RULE_LIST_KINDS_PARAMS_SCHEMA = EMPTY_PARAMS;
export const ALERT_RULE_LIST_KINDS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: ALERT_RULE_KIND_DESCRIPTOR_SCHEMA}
    }
};

/** Rule.ListMetricPaths — discover numeric component fields for threshold rules. */
export const ALERT_RULE_LIST_METRIC_PATHS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        shellyID: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export interface AlertMetricPath {
    component: string;
    field: string;
    label?: string;
    deviceClass?: AlertDeviceClass;
    unit?: string;
}

const METRIC_PATH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field'],
    properties: {
        component: {type: 'string'},
        field: {type: 'string'},
        label: {type: 'string'},
        deviceClass: {type: 'string', enum: [...ALERT_DEVICE_CLASSES]},
        unit: {type: 'string'}
    }
};

export const ALERT_RULE_LIST_METRIC_PATHS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: METRIC_PATH_SCHEMA}
    }
};

/** Rule.ListComponentPaths — discover metric and state fields for rule builders. */
export const ALERT_RULE_LIST_COMPONENT_PATHS_PARAMS_SCHEMA =
    ALERT_RULE_LIST_METRIC_PATHS_PARAMS_SCHEMA;

export interface AlertComponentPath extends AlertMetricPath {
    kind: 'metric' | 'state';
    valueType: 'number' | 'boolean' | 'string';
    values?: Array<number | string | boolean>;
}

const COMPONENT_PATH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'field', 'kind', 'valueType'],
    properties: {
        component: {type: 'string'},
        field: {type: 'string'},
        kind: {type: 'string', enum: ['metric', 'state']},
        valueType: {type: 'string', enum: ['number', 'boolean', 'string']},
        label: {type: 'string'},
        deviceClass: {type: 'string', enum: [...ALERT_DEVICE_CLASSES]},
        unit: {type: 'string'},
        values: {
            type: 'array',
            items: {type: ['number', 'string', 'boolean']},
            maxItems: 64
        }
    }
};

export const ALERT_RULE_LIST_COMPONENT_PATHS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: COMPONENT_PATH_SCHEMA}
    }
};

/** Rule.ListEligibleDevices — which accessible devices can host a rule kind. */
export const ALERT_RULE_LIST_ELIGIBLE_DEVICES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        kind: ALERT_KIND_SCHEMA,
        config: {type: 'object'}
    }
};

export const ALERT_RULE_LIST_ELIGIBLE_DEVICES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyIDs'],
    properties: {
        shellyIDs: {type: 'array', items: {type: 'string'}}
    }
};

export const ALERT_RULE_KIND_DESCRIPTORS: AlertRuleKindDescriptor[] = [
    {
        key: 'device_offline',
        defaultSeverity: 'warning',
        label: 'Device Offline',
        evaluationMode: 'absence',
        initialEvaluation: true,
        dataSource: 'presence_store',
        supportsForSec: true,
        clearBehavior: 'absence_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.device_offline
    },
    {
        key: 'device_back_online',
        defaultSeverity: 'info',
        label: 'Device Back Online',
        evaluationMode: 'event',
        initialEvaluation: false,
        dataSource: 'runtime_event',
        supportsForSec: false,
        clearBehavior: 'recovery_event',
        eventReplayPolicy: 'future_only',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.device_back_online
    },
    {
        key: 'battery_below',
        defaultSeverity: 'warning',
        label: 'Battery Below Threshold',
        evaluationMode: 'state',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: false,
        clearBehavior: 'state_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.battery_below
    },
    {
        key: 'smoke_alarm',
        defaultSeverity: 'critical',
        label: 'Smoke Alarm',
        evaluationMode: 'state',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: false,
        clearBehavior: 'state_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.smoke_alarm
    },
    {
        key: 'flood_alarm',
        defaultSeverity: 'critical',
        label: 'Flood Alarm',
        evaluationMode: 'state',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: false,
        clearBehavior: 'state_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.flood_alarm
    },
    {
        key: 'motion_detected',
        defaultSeverity: 'warning',
        label: 'Motion Detected',
        evaluationMode: 'state',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: false,
        clearBehavior: 'state_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.motion_detected
    },
    {
        key: 'component_threshold',
        defaultSeverity: 'warning',
        label: 'Sensor Threshold',
        evaluationMode: 'state',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: true,
        clearBehavior: 'state_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: ['component', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.component_threshold
    },
    {
        key: 'component_state',
        defaultSeverity: 'info',
        label: 'Sensor State',
        evaluationMode: 'state',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: true,
        clearBehavior: 'state_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.component_state
    },
    {
        key: 'firmware_operation_failed',
        defaultSeverity: 'warning',
        label: 'Firmware Operation Failed',
        evaluationMode: 'event',
        initialEvaluation: false,
        dataSource: 'runtime_event',
        supportsForSec: false,
        clearBehavior: 'manual',
        eventReplayPolicy: 'future_only',
        phaseAvailable: 1,
        supportsManualResolve: true,
        supportsAutoResolve: false,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.firmware_operation_failed
    },
    {
        key: 'backup_operation_failed',
        defaultSeverity: 'warning',
        label: 'Backup Operation Failed',
        evaluationMode: 'event',
        initialEvaluation: false,
        dataSource: 'runtime_event',
        supportsForSec: false,
        clearBehavior: 'manual',
        eventReplayPolicy: 'future_only',
        phaseAvailable: 1,
        supportsManualResolve: true,
        supportsAutoResolve: false,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.backup_operation_failed
    },
    {
        key: 'automation_run_failed',
        defaultSeverity: 'warning',
        label: 'Automation Run Failed',
        evaluationMode: 'event',
        initialEvaluation: false,
        dataSource: 'runtime_event',
        supportsForSec: false,
        clearBehavior: 'manual',
        eventReplayPolicy: 'future_only',
        phaseAvailable: 1,
        supportsManualResolve: true,
        supportsAutoResolve: false,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.automation_run_failed
    },
    {
        key: 'grafana_alert',
        defaultSeverity: 'warning',
        label: 'Grafana Alert',
        evaluationMode: 'event',
        initialEvaluation: false,
        dataSource: 'runtime_event',
        supportsForSec: false,
        clearBehavior: 'recovery_event',
        eventReplayPolicy: 'future_only',
        phaseAvailable: 1,
        supportsManualResolve: true,
        supportsAutoResolve: true,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.grafana_alert
    },
    {
        key: 'heartbeat',
        defaultSeverity: 'warning',
        label: 'Heartbeat (deadman)',
        evaluationMode: 'absence',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: false,
        clearBehavior: 'absence_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.heartbeat
    },
    {
        key: 'energy_consumption_threshold',
        defaultSeverity: 'warning',
        label: 'Energy Consumption Threshold',
        evaluationMode: 'window',
        initialEvaluation: true,
        dataSource: 'history_store',
        supportsForSec: false,
        clearBehavior: 'window_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema:
            ALERT_RULE_KIND_CONFIG_SCHEMAS.energy_consumption_threshold
    },
    {
        key: 'rate_of_change',
        defaultSeverity: 'warning',
        label: 'Rate of change',
        evaluationMode: 'window',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: false,
        clearBehavior: 'window_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.rate_of_change
    },
    {
        key: 'stuck_sensor',
        defaultSeverity: 'warning',
        label: 'Stuck sensor',
        evaluationMode: 'absence',
        initialEvaluation: true,
        dataSource: 'latest_status',
        supportsForSec: false,
        clearBehavior: 'absence_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.stuck_sensor
    },
    {
        key: 'composite',
        defaultSeverity: 'warning',
        label: 'Composite (AND/OR/NOT)',
        evaluationMode: 'composite',
        initialEvaluation: true,
        dataSource: 'mixed',
        supportsForSec: false,
        clearBehavior: 'composite_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: true,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.composite
    },
    {
        key: 'anomaly_band',
        defaultSeverity: 'warning',
        label: 'Anomaly band (mean ± k·σ)',
        evaluationMode: 'window',
        initialEvaluation: true,
        dataSource: 'history_store',
        supportsForSec: false,
        clearBehavior: 'window_recovery',
        eventReplayPolicy: 'not_applicable',
        phaseAvailable: 1,
        supportsManualResolve: false,
        supportsAutoResolve: true,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.anomaly_band
    },
    {
        key: 'change_event',
        defaultSeverity: 'info',
        label: 'Categorical change event',
        evaluationMode: 'event',
        initialEvaluation: false,
        dataSource: 'runtime_event',
        supportsForSec: false,
        clearBehavior: 'manual',
        eventReplayPolicy: 'future_only',
        phaseAvailable: 1,
        supportsManualResolve: true,
        supportsAutoResolve: false,
        supportedScopeTypes: [
            'device',
            'component',
            'group',
            'location',
            'tag'
        ],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.change_event
    },
    {
        key: 'device_event',
        defaultSeverity: 'info',
        label: 'Device pushes event',
        evaluationMode: 'event',
        initialEvaluation: false,
        dataSource: 'runtime_event',
        supportsForSec: false,
        clearBehavior: 'manual',
        eventReplayPolicy: 'future_only',
        phaseAvailable: 1,
        supportsManualResolve: true,
        supportsAutoResolve: false,
        supportedScopeTypes: ['device', 'group', 'location', 'tag'],
        configSchema: ALERT_RULE_KIND_CONFIG_SCHEMAS.device_event
    }
];

export const ALERT_RULE_KIND_DESCRIPTOR_BY_KEY: Record<
    AlertRuleKind,
    AlertRuleKindDescriptor
> = Object.fromEntries(
    ALERT_RULE_KIND_DESCRIPTORS.map((item) => [item.key, item])
) as Record<AlertRuleKind, AlertRuleKindDescriptor>;

export const ALERT_RULE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'name',
        'kind',
        'enabled',
        'severity',
        'scope',
        'dedupeWindowSec',
        'cooldownSec',
        'destinationGroupIds',
        'destinationChannelIds',
        'deliveryMode',
        'digestWindowMinutes',
        'ownerUserId',
        'summaryTemplate',
        'messageTemplate',
        'autoResolve',
        'config',
        'groupBy',
        'runbookUrl',
        'templateId',
        'lastFiredAt',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        kind: ALERT_KIND_SCHEMA,
        enabled: {type: 'boolean'},
        severity: ALERT_SEVERITY_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        dedupeWindowSec: NON_NEGATIVE_INT4_SCHEMA,
        cooldownSec: NON_NEGATIVE_INT4_SCHEMA,
        destinationGroupIds: DESTINATION_GROUP_IDS_SCHEMA,
        destinationChannelIds: DESTINATION_CHANNEL_IDS_SCHEMA,
        deliveryMode: {type: 'string', enum: ['instant', 'digest']},
        digestWindowMinutes: {type: ['integer', 'null'], minimum: 1},
        ownerUserId: OPTIONAL_USER_ID_SCHEMA,
        summaryTemplate: OPTIONAL_TEXT_SCHEMA,
        messageTemplate: OPTIONAL_TEXT_SCHEMA,
        autoResolve: {type: 'boolean'},
        config: {
            type: 'object',
            additionalProperties: true
        },
        groupBy: GROUP_BY_SCHEMA,
        runbookUrl: {type: ['string', 'null'], maxLength: 2000},
        templateId: {type: ['integer', 'null']},
        lastFiredAt: {type: ['string', 'null']},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const ALERT_INSTANCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'ruleId',
        'ruleKind',
        'state',
        'severity',
        'source',
        'title',
        'message',
        'fingerprint',
        'activeSince',
        'lastTriggeredAt',
        'acknowledgedAt',
        'acknowledgedBy',
        'ackComment',
        'resolvedAt',
        'silencedUntil',
        'silenceReason',
        'counts',
        'context'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        ruleId: {type: 'integer'},
        ruleKind: ALERT_KIND_SCHEMA,
        state: ALERT_STATE_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        source: ALERT_SOURCE_REF_SCHEMA,
        title: {type: 'string', minLength: 1, maxLength: 255},
        message: {type: 'string'},
        fingerprint: SUBJECT_ID_SCHEMA,
        activeSince: {type: 'string'},
        lastTriggeredAt: {type: 'string'},
        acknowledgedAt: {type: ['string', 'null']},
        acknowledgedBy: OPTIONAL_ACTOR_REF_SCHEMA,
        ackComment: {type: ['string', 'null'], maxLength: 500},
        resolvedAt: {type: ['string', 'null']},
        silencedUntil: {type: ['string', 'null']},
        silenceReason: OPTIONAL_TEXT_SCHEMA,
        counts: {
            type: 'object',
            additionalProperties: false,
            required: ['notificationsCreated', 'deliveryJobsCreated'],
            properties: {
                notificationsCreated: {type: 'integer', minimum: 0},
                deliveryJobsCreated: {type: 'integer', minimum: 0}
            }
        },
        context: {
            type: 'object',
            additionalProperties: true
        }
    }
};

export const ALERT_TRANSITION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['at', 'action', 'actor', 'data'],
    properties: {
        at: {type: 'string'},
        action: ALERT_TRANSITION_ACTION_SCHEMA,
        actor: OPTIONAL_ACTOR_REF_SCHEMA,
        data: {
            type: 'object',
            additionalProperties: true
        }
    }
};

const ALERT_RULE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: ALERT_RULE_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const ALERT_INSTANCE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: ALERT_INSTANCE_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const ALERT_TRANSITION_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: ALERT_TRANSITION_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const DELETED_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'id'],
    properties: {
        deleted: {type: 'boolean'},
        id: {type: 'integer'}
    }
};

export const ALERT_RULE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        enabled: {type: 'boolean'},
        kind: ALERT_KIND_SCHEMA,
        query: QUERY_SCHEMA,
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const ALERT_RULE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const ALERT_RULE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    // Recipients are optional in the schema; the handler enforces "at least one
    // channel or group" so a rule can target channels without any group.
    required: ['name', 'kind', 'severity', 'scope'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        kind: ALERT_KIND_SCHEMA,
        enabled: {type: 'boolean', default: true},
        severity: ALERT_SEVERITY_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        dedupeWindowSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0},
        cooldownSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0},
        destinationGroupIds: DESTINATION_GROUP_IDS_SCHEMA,
        destinationChannelIds: DESTINATION_CHANNEL_IDS_SCHEMA,
        deliveryMode: {
            type: 'string',
            enum: ['instant', 'digest'],
            default: 'instant'
        },
        digestWindowMinutes: {
            type: ['integer', 'null'],
            minimum: 1,
            default: null
        },
        ownerUserId: OPTIONAL_USER_ID_SCHEMA,
        summaryTemplate: OPTIONAL_TEXT_SCHEMA,
        messageTemplate: OPTIONAL_TEXT_SCHEMA,
        autoResolve: {type: 'boolean'},
        config: ALERT_CONFIG_SCHEMA,
        groupBy: GROUP_BY_SCHEMA,
        runbookUrl: {type: ['string', 'null'], maxLength: 2000},
        templateId: {type: ['integer', 'null']}
    }
};

export const ALERT_RULE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'patch'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                enabled: {type: 'boolean'},
                severity: ALERT_SEVERITY_SCHEMA,
                scope: ALERT_SCOPE_SELECTOR_SCHEMA,
                dedupeWindowSec: NON_NEGATIVE_INT4_SCHEMA,
                cooldownSec: NON_NEGATIVE_INT4_SCHEMA,
                destinationGroupIds: DESTINATION_GROUP_IDS_SCHEMA,
                destinationChannelIds: DESTINATION_CHANNEL_IDS_SCHEMA,
                deliveryMode: {type: 'string', enum: ['instant', 'digest']},
                digestWindowMinutes: {type: ['integer', 'null'], minimum: 1},
                ownerUserId: OPTIONAL_USER_ID_SCHEMA,
                summaryTemplate: OPTIONAL_TEXT_SCHEMA,
                messageTemplate: OPTIONAL_TEXT_SCHEMA,
                autoResolve: {type: 'boolean'},
                config: ALERT_CONFIG_SCHEMA,
                groupBy: GROUP_BY_SCHEMA,
                runbookUrl: {type: ['string', 'null'], maxLength: 2000},
                templateId: {type: ['integer', 'null']}
            }
        }
    }
};

export const ALERT_RULE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

// Duplicate detection — same fields as Create (minus the non-semantic
// ones: name, destinations, owner, templates, enabled, autoResolve).
// excludeId lets an Update form skip matching itself.
export const ALERT_RULE_CHECK_DUPLICATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'severity', 'scope'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        kind: ALERT_KIND_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        dedupeWindowSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0},
        cooldownSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0},
        config: ALERT_CONFIG_SCHEMA,
        excludeId: {type: 'integer', minimum: 1}
    }
};

export const ALERT_RULE_CHECK_DUPLICATE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['duplicate'],
    properties: {
        duplicate: {
            oneOf: [
                {type: 'null'},
                {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'name'],
                    properties: {
                        id: {type: 'integer'},
                        name: {type: 'string'}
                    }
                }
            ]
        }
    }
};

// Rule templates — pre-built catalog the frontend lists in the rule
// builder. CreateFromTemplate instantiates a real rule using the
// template's defaults plus caller-supplied scope + destinations.
export interface AlertRuleTemplate {
    id: number;
    /** Null = global seed template; non-null = org-authored. */
    organizationId: string | null;
    templateKey: string;
    category: string;
    label: string;
    description: string | null;
    kind: AlertRuleKind;
    severity: AlertSeverity;
    scope: ScopeSelector;
    config: Record<string, unknown>;
    dedupeWindowSec: number;
    cooldownSec: number;
    summaryTemplate: string | null;
    messageTemplate: string | null;
    autoResolve: boolean;
    /** User id of the org-authoring user; null for global templates. */
    authorUserId: string | null;
}

export const ALERT_RULE_TEMPLATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'templateKey',
        'category',
        'label',
        'description',
        'kind',
        'severity',
        'scope',
        'config',
        'dedupeWindowSec',
        'cooldownSec',
        'summaryTemplate',
        'messageTemplate',
        'autoResolve',
        'authorUserId'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: {type: ['string', 'null']},
        templateKey: {type: 'string', minLength: 1, maxLength: 64},
        category: {type: 'string', minLength: 1, maxLength: 32},
        label: {type: 'string', minLength: 1, maxLength: 120},
        description: OPTIONAL_TEXT_SCHEMA,
        kind: ALERT_KIND_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        config: {type: 'object', additionalProperties: true},
        dedupeWindowSec: NON_NEGATIVE_INT4_SCHEMA,
        cooldownSec: NON_NEGATIVE_INT4_SCHEMA,
        summaryTemplate: OPTIONAL_TEXT_SCHEMA,
        messageTemplate: OPTIONAL_TEXT_SCHEMA,
        autoResolve: {type: 'boolean'},
        authorUserId: {type: ['string', 'null']}
    }
};

export const ALERT_RULE_TEMPLATE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['templateKey', 'category', 'label', 'kind', 'severity'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        templateKey: {type: 'string', minLength: 1, maxLength: 64},
        category: {type: 'string', minLength: 1, maxLength: 32},
        label: {type: 'string', minLength: 1, maxLength: 120},
        description: OPTIONAL_TEXT_SCHEMA,
        kind: ALERT_KIND_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        config: {type: 'object', additionalProperties: true},
        dedupeWindowSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0},
        cooldownSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0},
        summaryTemplate: OPTIONAL_TEXT_SCHEMA,
        messageTemplate: OPTIONAL_TEXT_SCHEMA,
        autoResolve: {type: 'boolean'}
    }
};

export const ALERT_RULE_TEMPLATE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        label: {type: 'string', minLength: 1, maxLength: 120},
        description: OPTIONAL_TEXT_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        config: {type: 'object', additionalProperties: true},
        dedupeWindowSec: NON_NEGATIVE_INT4_SCHEMA,
        cooldownSec: NON_NEGATIVE_INT4_SCHEMA,
        summaryTemplate: OPTIONAL_TEXT_SCHEMA,
        messageTemplate: OPTIONAL_TEXT_SCHEMA,
        autoResolve: {type: 'boolean'}
    }
};

export const ALERT_RULE_TEMPLATE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const ALERT_RULE_TEMPLATE_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

export const ALERT_RULE_LIST_TEMPLATES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        category: {type: 'string', minLength: 1, maxLength: 32}
    }
};

export const ALERT_RULE_LIST_TEMPLATES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: ALERT_RULE_TEMPLATE_SCHEMA}
    }
};

// Per-rule firing history. One row per 'created'/'triggered' transition
// joined with the owning alert instance so callers see which subject fired.
export interface AlertRuleFiring {
    transitionId: number;
    alertId: number;
    action: Extract<AlertTransitionAction, 'created' | 'triggered'>;
    firedAt: string;
    source: AlertSourceRef;
    severity: AlertSeverity;
    title: string;
}

const ALERT_RULE_FIRING_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'transitionId',
        'alertId',
        'action',
        'firedAt',
        'source',
        'severity',
        'title'
    ],
    properties: {
        transitionId: {type: 'integer'},
        alertId: {type: 'integer'},
        action: {type: 'string', enum: ['created', 'triggered']},
        firedAt: {type: 'string'},
        source: ALERT_SOURCE_REF_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        title: {type: 'string', minLength: 1, maxLength: 255}
    }
};

export const ALERT_RULE_LIST_FIRINGS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const ALERT_RULE_LIST_FIRINGS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: ALERT_RULE_FIRING_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

// Rule.Preview — side-effect-free dry run against current device state.
// Caller may supply a rule spec (same shape as Create, minus name/destinations
// which are not relevant to evaluation) or ruleId for a saved rule.
export interface AlertRulePreviewMatch {
    subject: SourceRef;
    title: string;
    message: string;
    severity: AlertSeverity;
    fingerprint: string;
    context: Record<string, unknown>;
}

const ALERT_RULE_PREVIEW_MATCH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'subject',
        'title',
        'message',
        'severity',
        'fingerprint',
        'context'
    ],
    properties: {
        subject: ALERT_SOURCE_REF_SCHEMA,
        title: {type: 'string', minLength: 1, maxLength: 255},
        message: {type: 'string'},
        severity: ALERT_SEVERITY_SCHEMA,
        fingerprint: {type: 'string', minLength: 1, maxLength: 255},
        context: {type: 'object', additionalProperties: true}
    }
};

export const ALERT_RULE_PREVIEW_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    // Either ruleId (saved rule) or (kind + severity + scope) for an unsaved draft.
    properties: {
        organizationId: ORG_ID_SCHEMA,
        ruleId: {type: 'integer', minimum: 1},
        kind: ALERT_KIND_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        config: ALERT_CONFIG_SCHEMA,
        dedupeWindowSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0},
        cooldownSec: {...NON_NEGATIVE_INT4_SCHEMA, default: 0}
    }
};

export const ALERT_RULE_PREVIEW_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'matches',
        'matchCount',
        'scanned',
        'supportedKind',
        'truncated',
        'note'
    ],
    properties: {
        matches: {type: 'array', items: ALERT_RULE_PREVIEW_MATCH_SCHEMA},
        matchCount: {type: 'integer', minimum: 0},
        scanned: {type: 'integer', minimum: 0},
        supportedKind: {type: 'boolean'},
        truncated: {type: 'boolean'},
        note: {type: ['string', 'null']}
    }
};

export const ALERT_RULE_CREATE_FROM_TEMPLATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['templateKey', 'name', 'scope'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        templateKey: {type: 'string', minLength: 1, maxLength: 64},
        name: NAME_SCHEMA,
        scope: ALERT_SCOPE_SELECTOR_SCHEMA,
        destinationGroupIds: DESTINATION_GROUP_IDS_SCHEMA,
        destinationChannelIds: DESTINATION_CHANNEL_IDS_SCHEMA,
        // Optional per-instance overrides — fall back to the template's
        // values when omitted. Keeping them optional lets callers use
        // the template as-is for the common case.
        enabled: {type: 'boolean'},
        ownerUserId: OPTIONAL_USER_ID_SCHEMA,
        configOverride: ALERT_CONFIG_SCHEMA,
        summaryTemplateOverride: OPTIONAL_TEXT_SCHEMA,
        messageTemplateOverride: OPTIONAL_TEXT_SCHEMA
    }
};

export const ALERT_INSTANCE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        state: ALERT_STATE_SCHEMA,
        severity: ALERT_SEVERITY_SCHEMA,
        ruleId: {type: 'integer'},
        sourceType: {type: 'string', enum: [...ALERT_SCOPE_TYPES]},
        sourceId: SUBJECT_ID_SCHEMA,
        locationIds: INT_ARRAY_SCHEMA,
        groupIds: INT_ARRAY_SCHEMA,
        tagIds: INT_ARRAY_SCHEMA,
        query: QUERY_SCHEMA,
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const ALERT_INSTANCE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const ALERT_INSTANCE_LIST_TRANSITIONS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const ALERT_INSTANCE_ACK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        comment: {type: 'string', maxLength: 500}
    }
};

export const ALERT_INSTANCE_UNACK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const ALERT_INSTANCE_SILENCE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'until'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        until: {type: 'string', minLength: 1},
        reason: OPTIONAL_TEXT_SCHEMA
    }
};

export const ALERT_INSTANCE_UNSILENCE_PARAMS_SCHEMA: JsonSchema =
    ALERT_INSTANCE_ACK_PARAMS_SCHEMA;

export const ALERT_INSTANCE_RESOLVE_MANUAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

const ANNOTATION_BODY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 2000
};

export const ALERT_ANNOTATION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'alertInstanceId',
        'organizationId',
        'author',
        'body',
        'createdAt',
        'editedAt'
    ],
    properties: {
        id: {type: 'integer'},
        alertInstanceId: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        author: ALERT_ACTOR_REF_SCHEMA,
        body: ANNOTATION_BODY_SCHEMA,
        createdAt: {type: 'string'},
        editedAt: {type: ['string', 'null']}
    }
};

export const ALERT_ANNOTATION_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: ALERT_ANNOTATION_SCHEMA}
    }
};

export const ALERT_ANNOTATION_APPEND_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['alertInstanceId', 'body'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        alertInstanceId: {type: 'integer'},
        body: ANNOTATION_BODY_SCHEMA
    }
};

export const ALERT_ANNOTATION_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['alertInstanceId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        alertInstanceId: {type: 'integer'}
    }
};

export const ALERT_ANNOTATION_EDIT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'body'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        body: ANNOTATION_BODY_SCHEMA
    }
};

export const ALERT_ANNOTATION_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const ALERT_ANNOTATION_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

export const ALERT_DESCRIBE: DescribeOutput = new DescribeBuilder('alert', {
    kind: 'fleet-manager',
    description:
        'Manage alerting — rules, rule templates, instances, acknowledgements, and firing history.'
})
    .registerMethod('Rule.ListKinds', {
        params: ALERT_RULE_LIST_KINDS_PARAMS_SCHEMA,
        response: ALERT_RULE_LIST_KINDS_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'Return backend-driven alert rule kinds, scope support, and config schemas.'
    })
    .registerMethod('Rule.ListMetricPaths', {
        params: ALERT_RULE_LIST_METRIC_PATHS_PARAMS_SCHEMA,
        response: ALERT_RULE_LIST_METRIC_PATHS_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'Discover numeric metric paths (component + field) from live device status. Feeds the sensor threshold rule builder.'
    })
    .registerMethod('Rule.ListComponentPaths', {
        params: ALERT_RULE_LIST_COMPONENT_PATHS_PARAMS_SCHEMA,
        response: ALERT_RULE_LIST_COMPONENT_PATHS_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'Discover metric and state component paths from live device status. Feeds threshold and state rule builders.'
    })
    .registerMethod('Rule.ListEligibleDevices', {
        params: ALERT_RULE_LIST_ELIGIBLE_DEVICES_PARAMS_SCHEMA,
        response: ALERT_RULE_LIST_ELIGIBLE_DEVICES_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'Accessible devices that can host the given rule kind, judged from their reported components. Drives the rule builder device picker.'
    })
    .registerMethod('Rule.List', {
        params: ALERT_RULE_LIST_PARAMS_SCHEMA,
        response: ALERT_RULE_LIST_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description: 'List alert rules in the caller organization.'
    })
    .registerMethod('Rule.Get', {
        params: ALERT_RULE_GET_PARAMS_SCHEMA,
        response: ALERT_RULE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description: 'Return one alert rule.'
    })
    .registerMethod('Rule.Create', {
        params: ALERT_RULE_CREATE_PARAMS_SCHEMA,
        response: ALERT_RULE_SCHEMA,
        permission: {component: 'alerts', operation: 'create'},
        description:
            'Create an alert rule with backend-validated scope, routing, and config.'
    })
    .registerMethod('Rule.Update', {
        params: ALERT_RULE_UPDATE_PARAMS_SCHEMA,
        response: ALERT_RULE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Update an alert rule.'
    })
    .registerMethod('Rule.Delete', {
        params: ALERT_RULE_DELETE_PARAMS_SCHEMA,
        response: DELETED_SCHEMA,
        permission: {component: 'alerts', operation: 'delete'},
        description:
            'Delete an alert rule if no alert instances still reference it.'
    })
    .registerMethod('Rule.CheckDuplicate', {
        params: ALERT_RULE_CHECK_DUPLICATE_PARAMS_SCHEMA,
        response: ALERT_RULE_CHECK_DUPLICATE_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'Return a matching rule (same kind + severity + scope + config + throttling) in this org, if any. Call before Create/Update to warn on accidental duplicates.'
    })
    .registerMethod('Rule.ListTemplates', {
        params: ALERT_RULE_LIST_TEMPLATES_PARAMS_SCHEMA,
        response: ALERT_RULE_LIST_TEMPLATES_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'List pre-built alert rule templates. Frontend renders these in the builder "from template" picker.'
    })
    .registerMethod('Rule.CreateFromTemplate', {
        params: ALERT_RULE_CREATE_FROM_TEMPLATE_PARAMS_SCHEMA,
        response: ALERT_RULE_SCHEMA,
        permission: {component: 'alerts', operation: 'create'},
        description:
            'Instantiate an alert rule from a template. Template supplies kind/severity/config/throttling defaults; caller supplies name + scope + destinations and optional overrides.'
    })
    .registerMethod('Rule.Template.Create', {
        params: ALERT_RULE_TEMPLATE_CREATE_PARAMS_SCHEMA,
        response: ALERT_RULE_TEMPLATE_SCHEMA,
        permission: {component: 'alerts', operation: 'create'},
        description:
            'Author an org-scoped alert rule template. organization_id is set from sender authority.'
    })
    .registerMethod('Rule.Template.Update', {
        params: ALERT_RULE_TEMPLATE_UPDATE_PARAMS_SCHEMA,
        response: ALERT_RULE_TEMPLATE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description:
            'Edit an org-authored template. Only the original author may edit.'
    })
    .registerMethod('Rule.Template.Delete', {
        params: ALERT_RULE_TEMPLATE_DELETE_PARAMS_SCHEMA,
        response: ALERT_RULE_TEMPLATE_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'delete'},
        description:
            'Delete an org-authored template. Only the original author may delete.'
    })
    .registerMethod('Rule.ListFirings', {
        params: ALERT_RULE_LIST_FIRINGS_PARAMS_SCHEMA,
        response: ALERT_RULE_LIST_FIRINGS_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'Return the per-rule firing history (created + triggered transitions joined with source subject), newest first.'
    })
    .registerMethod('Rule.Preview', {
        params: ALERT_RULE_PREVIEW_PARAMS_SCHEMA,
        response: ALERT_RULE_PREVIEW_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description:
            'Dry-run a rule (saved ruleId or draft spec) against current device state. Side-effect-free. Event-driven kinds return supportedKind=false.'
    })
    .registerMethod('Instance.List', {
        params: ALERT_INSTANCE_LIST_PARAMS_SCHEMA,
        response: ALERT_INSTANCE_LIST_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description: 'List alert instances in the caller organization.'
    })
    .registerMethod('Instance.Get', {
        params: ALERT_INSTANCE_GET_PARAMS_SCHEMA,
        response: ALERT_INSTANCE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description: 'Return one alert instance.'
    })
    .registerMethod('Instance.ListTransitions', {
        params: ALERT_INSTANCE_LIST_TRANSITIONS_PARAMS_SCHEMA,
        response: ALERT_TRANSITION_LIST_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description: 'List state transitions for one alert instance.'
    })
    .registerMethod('Instance.Ack', {
        params: ALERT_INSTANCE_ACK_PARAMS_SCHEMA,
        response: ALERT_INSTANCE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Acknowledge one active alert instance.'
    })
    .registerMethod('Instance.Unack', {
        params: ALERT_INSTANCE_UNACK_PARAMS_SCHEMA,
        response: ALERT_INSTANCE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Return an acknowledged alert instance to active state.'
    })
    .registerMethod('Instance.Silence', {
        params: ALERT_INSTANCE_SILENCE_PARAMS_SCHEMA,
        response: ALERT_INSTANCE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Silence an alert instance until a given timestamp.'
    })
    .registerMethod('Instance.Unsilence', {
        params: ALERT_INSTANCE_UNSILENCE_PARAMS_SCHEMA,
        response: ALERT_INSTANCE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Clear the silence window for an alert instance.'
    })
    .registerMethod('Instance.ResolveManual', {
        params: ALERT_INSTANCE_RESOLVE_MANUAL_PARAMS_SCHEMA,
        response: ALERT_INSTANCE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Manually resolve a manual-resolve-capable alert instance.'
    })
    .registerMethod('Instance.Annotate', {
        params: ALERT_ANNOTATION_APPEND_PARAMS_SCHEMA,
        response: ALERT_ANNOTATION_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Append a free-form annotation to an alert instance.'
    })
    .registerMethod('Instance.ListAnnotations', {
        params: ALERT_ANNOTATION_LIST_PARAMS_SCHEMA,
        response: ALERT_ANNOTATION_LIST_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'read'},
        description: 'List annotations attached to an alert instance.'
    })
    .registerMethod('Instance.EditAnnotation', {
        params: ALERT_ANNOTATION_EDIT_PARAMS_SCHEMA,
        response: ALERT_ANNOTATION_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description: 'Edit an annotation; only the original author may edit.'
    })
    .registerMethod('Instance.DeleteAnnotation', {
        params: ALERT_ANNOTATION_DELETE_PARAMS_SCHEMA,
        response: ALERT_ANNOTATION_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'alerts', operation: 'update'},
        description:
            'Delete an annotation; only the original author may delete.'
    })
    .build();
