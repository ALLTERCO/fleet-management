import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {electrical, sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const CHANNEL_ID: JsonSchema = {type: 'integer', minimum: 0};

const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA, id: CHANNEL_ID}
};

const RESP_OPAQUE: JsonSchema = {
    description: 'Device-defined (object or null).'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

// ── Per-method exports ──────────────────────────────────────────────

export interface SwitchSetParams {
    shellyID: string;
    id: number;
    on: boolean;
    toggle_after?: number;
}
// Extra fields tolerated for forward compatibility — device validates ranges.
// toggle_after: number (device accepts integer + float — verified live).
export const SWITCH_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'on'],
    additionalProperties: true,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        on: {type: 'boolean'},
        toggle_after: {type: 'number'}
    }
};

export interface SwitchToggleParams {
    shellyID: string;
    id: number;
}
export const SWITCH_TOGGLE_PARAMS_SCHEMA = P_ID;

export interface SwitchSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const SWITCH_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        config: {type: 'object'}
    }
};

export interface SwitchResetCountersParams {
    shellyID: string;
    id: number;
    types?: string[];
}
export const SWITCH_RESET_COUNTERS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        types: {type: 'array', items: {type: 'string'}}
    }
};

export interface SwitchGetConfigParams {
    shellyID: string;
    id: number;
}
export const SWITCH_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface SwitchGetStatusParams {
    shellyID: string;
    id: number;
}
export const SWITCH_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('switch', {
    kind: 'device',
    description:
        'Control and configure switch output channels on the target device.'
});

b.registerMethod('Set', {
    params: SWITCH_SET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Switch.Set — set output on/off (+ optional toggle_after).'
});
b.registerMethod('Toggle', {
    params: SWITCH_TOGGLE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Switch.Toggle.'
});
b.registerMethod('SetConfig', {
    params: SWITCH_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Switch.SetConfig — partial config patch.'
});
b.registerMethod('ResetCounters', {
    params: SWITCH_RESET_COUNTERS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Switch.ResetCounters — clear energy/counters.'
});
b.registerMethod('GetConfig', {
    params: SWITCH_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Switch.GetConfig — fetch persisted config for one channel.'
});
b.registerMethod('GetStatus', {
    params: SWITCH_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Switch.GetStatus — runtime state for one channel.'
});

const SWITCH_METRICS: MetricDescriptor[] = [
    electrical('apower', 'active_power', {optional: true}),
    electrical('voltage', 'voltage', {optional: true}),
    electrical('current', 'current', {optional: true}),
    electrical('pf', 'power_factor', {optional: true}),
    electrical('freq', 'frequency', {optional: true}),
    electrical('aenergy_total', 'active_energy', {
        optional: true,
        direction: 'import'
    }),
    electrical('ret_aenergy_total', 'active_energy', {
        optional: true,
        direction: 'export'
    }),
    sensor('temperature_tc', '°C', {optional: true}),
    sensor('temperature_tf', '°F', {optional: true})
];

b.setMetrics(SWITCH_METRICS);

export const SWITCH_DESCRIBE: DescribeOutput = b.build();
