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
// RGB.DimUp / DimDown — per spec: required {id}, optional {fade_rate}.
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

export interface RgbSetParams {
    shellyID: string;
    id: number;
    on?: boolean;
    brightness?: number;
    rgb?: number[];
    transition?: number;
}
export const RGB_SET_PARAMS_SCHEMA = P_SET;

export interface RgbToggleParams {
    shellyID: string;
    id: number;
}
export const RGB_TOGGLE_PARAMS_SCHEMA = P_ID;

export interface RgbSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const RGB_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface RgbGetConfigParams {
    shellyID: string;
    id: number;
}
export const RGB_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface RgbGetStatusParams {
    shellyID: string;
    id: number;
}
export const RGB_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface RgbDimParams {
    shellyID: string;
    id: number;
    fade_rate?: number;
}
export const RGB_DIM_PARAMS_SCHEMA = P_DIM;
export const RGB_DIM_STOP_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('rgb', {
    kind: 'device',
    description:
        'Relay RGB light control, config, and dimming RPCs to a Shelly device.'
});

b.registerMethod('Set', {
    params: P_SET,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGB.Set — rgb/brightness/transition/state.'
});
b.registerMethod('Toggle', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGB.Toggle.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'RGB.SetConfig.'
});
b.registerMethod('GetConfig', {
    params: RGB_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'RGB.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: RGB_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'RGB.GetStatus.'
});
b.registerMethod('DimUp', {
    params: RGB_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGB.DimUp — optional fade_rate [1,5].'
});
b.registerMethod('DimDown', {
    params: RGB_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGB.DimDown — optional fade_rate [1,5].'
});
b.registerMethod('DimStop', {
    params: RGB_DIM_STOP_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'RGB.DimStop.'
});

const RGB_METRICS: MetricDescriptor[] = [
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

b.setMetrics(RGB_METRICS);

export const RGB_DESCRIBE: DescribeOutput = b.build();
