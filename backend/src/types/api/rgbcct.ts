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
// Envelope fields are typed; ranges are device-validated.
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
        ct: {type: 'integer'},
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
// RGBCCT.DimUp / DimDown — per spec: required {id}, optional {fade_rate}.
// fade_rate range [1,5] where 5 is fastest; defaults to button_fade_rate.
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

export interface RgbcctSetParams {
    shellyID: string;
    id: number;
    on?: boolean;
    brightness?: number;
    rgb?: number[];
    white?: number;
    ct?: number;
    transition?: number;
}
export const RGBCCT_SET_PARAMS_SCHEMA = P_SET;

export interface RgbcctToggleParams {
    shellyID: string;
    id: number;
}
export const RGBCCT_TOGGLE_PARAMS_SCHEMA = P_ID;

export interface RgbcctSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const RGBCCT_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface RgbcctGetConfigParams {
    shellyID: string;
    id: number;
}
export const RGBCCT_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface RgbcctGetStatusParams {
    shellyID: string;
    id: number;
}
export const RGBCCT_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface RgbcctDimParams {
    shellyID: string;
    id: number;
    fade_rate?: number;
}
export const RGBCCT_DIM_PARAMS_SCHEMA = P_DIM;
export const RGBCCT_DIM_STOP_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('rgbcct', {
    kind: 'device',
    description:
        'Relay RGBCCT light control, config, and dimming RPCs to a Shelly device.'
});

b.registerMethod('Set', {
    params: P_SET,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBCCT.Set — rgb/white/ct/brightness/transition/state.'
});
b.registerMethod('Toggle', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBCCT.Toggle.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'RGBCCT.SetConfig.'
});
b.registerMethod('GetConfig', {
    params: RGBCCT_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'RGBCCT.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: RGBCCT_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'RGBCCT.GetStatus.'
});
b.registerMethod('DimUp', {
    params: RGBCCT_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBCCT.DimUp.'
});
b.registerMethod('DimDown', {
    params: RGBCCT_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBCCT.DimDown.'
});
b.registerMethod('DimStop', {
    params: RGBCCT_DIM_STOP_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGBCCT.DimStop.'
});

const RGBCCT_METRICS: MetricDescriptor[] = [
    sensor('brightness', '%'),
    sensor('ct', 'K', {optional: true}),
    electrical('apower', 'active_power', {optional: true}),
    electrical('aenergy_total', 'active_energy', {
        optional: true,
        direction: 'import'
    })
];

b.setMetrics(RGBCCT_METRICS);

export const RGBCCT_DESCRIBE: DescribeOutput = b.build();
