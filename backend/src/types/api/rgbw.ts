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
// Envelope fields are typed; ranges are device-validated (white and
// brightness scales vary across RGBW firmware revisions).
const P_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: true,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        on: {type: 'boolean'},
        brightness: {type: 'integer'},
        rgb: {type: 'array', items: {type: 'integer'}},
        white: {type: 'integer'},
        transition: {type: 'number'}
    }
};
const P_SET_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        config: {type: 'object'}
    }
};
// RGBW.DimUp / DimDown — per spec: required {id}, optional {fade_rate}.
const P_DIM: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        fade_rate: {type: 'integer'}
    }
};

const RESP_OPAQUE: JsonSchema = {
    description: 'Device-defined (object or null).'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

export interface RgbwSetParams {
    shellyID: string;
    id: number;
    on?: boolean;
    brightness?: number;
    rgb?: number[];
    white?: number;
    transition?: number;
}
export const RGBW_SET_PARAMS_SCHEMA = P_SET;

export interface RgbwToggleParams {
    shellyID: string;
    id: number;
}
export const RGBW_TOGGLE_PARAMS_SCHEMA = P_ID;

export interface RgbwSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const RGBW_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface RgbwGetConfigParams {
    shellyID: string;
    id: number;
}
export const RGBW_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface RgbwGetStatusParams {
    shellyID: string;
    id: number;
}
export const RGBW_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface RgbwDimParams {
    shellyID: string;
    id: number;
    fade_rate?: number;
}
export const RGBW_DIM_PARAMS_SCHEMA = P_DIM;
export const RGBW_DIM_STOP_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('rgbw', {
    kind: 'device',
    description:
        'Relay RGBW light control, config, and dimming RPCs to a Shelly device.'
});

b.registerMethod('Set', {
    params: P_SET,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBW.Set — rgb/white/brightness/transition/state.'
});
b.registerMethod('Toggle', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBW.Toggle.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'RGBW.SetConfig.'
});
b.registerMethod('GetConfig', {
    params: RGBW_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'RGBW.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: RGBW_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'RGBW.GetStatus.'
});
b.registerMethod('DimUp', {
    params: RGBW_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBW.DimUp — optional fade_rate [1,5].'
});
b.registerMethod('DimDown', {
    params: RGBW_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBW.DimDown — optional fade_rate [1,5].'
});
b.registerMethod('DimStop', {
    params: RGBW_DIM_STOP_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBW.DimStop.'
});

const RGBW_METRICS: MetricDescriptor[] = [
    sensor('brightness', '%'),
    electrical('apower', 'active_power', {optional: true}),
    electrical('voltage', 'voltage', {optional: true}),
    electrical('current', 'current', {optional: true}),
    electrical('aenergy_total', 'active_energy', {
        optional: true,
        direction: 'import'
    }),
    sensor('temperature_tc', '°C', {optional: true}),
    sensor('temperature_tf', '°F', {optional: true})
];

b.setMetrics(RGBW_METRICS);

export const RGBW_DESCRIBE: DescribeOutput = b.build();
