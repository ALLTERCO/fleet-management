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
// CCT.DimUp / DimDown — per spec: required {id}, optional {fade_rate}.
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

export interface CctSetParams {
    shellyID: string;
    id: number;
    on?: boolean;
    brightness?: number;
    ct?: number;
    transition?: number;
}
export const CCT_SET_PARAMS_SCHEMA = P_SET;

export interface CctToggleParams {
    shellyID: string;
    id: number;
}
export const CCT_TOGGLE_PARAMS_SCHEMA = P_ID;

export interface CctSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const CCT_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface CctGetConfigParams {
    shellyID: string;
    id: number;
}
export const CCT_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface CctGetStatusParams {
    shellyID: string;
    id: number;
}
export const CCT_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface CctDimParams {
    shellyID: string;
    id: number;
    fade_rate?: number;
}
export const CCT_DIM_PARAMS_SCHEMA = P_DIM;
export const CCT_DIM_STOP_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('cct', {
    kind: 'device',
    description:
        'Control and dim a CCT light channel including brightness and color temperature.'
});

b.registerMethod('Set', {
    params: P_SET,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'CCT.Set — ct/brightness/transition/state.'
});
b.registerMethod('Toggle', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'CCT.Toggle.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'CCT.SetConfig.'
});
b.registerMethod('GetConfig', {
    params: CCT_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'CCT.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: CCT_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'CCT.GetStatus.'
});
b.registerMethod('DimUp', {
    params: CCT_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'CCT.DimUp — optional fade_rate [1,5].'
});
b.registerMethod('DimDown', {
    params: CCT_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'CCT.DimDown — optional fade_rate [1,5].'
});
b.registerMethod('DimStop', {
    params: CCT_DIM_STOP_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'CCT.DimStop.'
});

const CCT_METRICS: MetricDescriptor[] = [
    sensor('brightness', '%'),
    sensor('ct', 'K', {optional: true}),
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

b.setMetrics(CCT_METRICS);

export const CCT_DESCRIBE: DescribeOutput = b.build();
