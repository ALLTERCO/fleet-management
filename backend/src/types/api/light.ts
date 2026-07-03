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
// Envelope fields are typed; ranges and device-specific fields are
// validated by firmware.
const P_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: true,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        on: {type: 'boolean'},
        brightness: {type: 'integer'},
        transition: {type: 'number'},
        temp: {type: 'integer'},
        toggle_after: {type: 'integer'}
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
// Light.DimUp / DimDown — per spec: required {id}, optional {fade_rate}.
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
const P_RESET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        types: {type: 'array', items: {type: 'string'}}
    }
};

const RESP_OPAQUE: JsonSchema = {
    description: 'Device-defined (object or null).'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

// Per-method exports for component handlers.

export interface LightSetParams {
    shellyID: string;
    id: number;
    on?: boolean;
    brightness?: number;
    transition?: number;
    temp?: number;
    toggle_after?: number;
}
export const LIGHT_SET_PARAMS_SCHEMA = P_SET;

export interface LightToggleParams {
    shellyID: string;
    id: number;
}
export const LIGHT_TOGGLE_PARAMS_SCHEMA = P_ID;

export interface LightSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const LIGHT_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface LightCalibrateParams {
    shellyID: string;
    id: number;
}
export const LIGHT_CALIBRATE_PARAMS_SCHEMA = P_ID;

export interface LightGetConfigParams {
    shellyID: string;
    id: number;
}
export const LIGHT_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface LightGetStatusParams {
    shellyID: string;
    id: number;
}
export const LIGHT_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface LightDimParams {
    shellyID: string;
    id: number;
    fade_rate?: number;
}
export const LIGHT_DIM_PARAMS_SCHEMA = P_DIM;
export const LIGHT_DIM_STOP_PARAMS_SCHEMA = P_ID;

export interface LightResetCountersParams {
    shellyID: string;
    id: number;
    types?: string[];
}
export const LIGHT_RESET_COUNTERS_PARAMS_SCHEMA = P_RESET;

// Light.SetAll — sets output + brightness on ALL light components at once.
// Spec: at least one of {on, brightness} required.
export interface LightSetAllParams {
    shellyID: string;
    on?: boolean;
    brightness?: number;
    transition_duration?: number;
    toggle_after?: number;
    offset?: number;
}
export const LIGHT_SET_ALL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        on: {type: 'boolean'},
        brightness: {type: 'number'},
        transition_duration: {type: 'number'},
        toggle_after: {type: 'number'},
        offset: {type: 'integer'}
    },
    anyOf: [{required: ['on']}, {required: ['brightness']}]
};

const b = new DescribeBuilder('light', {
    kind: 'device',
    description: 'Control and configure a dimmable light channel on a device.'
});

b.registerMethod('Set', {
    params: P_SET,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Light.Set — state/brightness/temp/transition.'
});
b.registerMethod('Toggle', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Light.Toggle.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Light.SetConfig.'
});
b.registerMethod('Calibrate', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Light.Calibrate.'
});
b.registerMethod('GetConfig', {
    params: LIGHT_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Light.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: LIGHT_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Light.GetStatus.'
});
b.registerMethod('DimUp', {
    params: LIGHT_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Light.DimUp — incremental brighten (optional step).'
});
b.registerMethod('DimDown', {
    params: LIGHT_DIM_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Light.DimDown — incremental dim (optional step).'
});
b.registerMethod('DimStop', {
    params: LIGHT_DIM_STOP_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Light.DimStop — stop ongoing dim ramp.'
});
b.registerMethod('ResetCounters', {
    params: LIGHT_RESET_COUNTERS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Light.ResetCounters.'
});
b.registerMethod('SetAll', {
    params: LIGHT_SET_ALL_PARAMS_SCHEMA,
    response: {type: 'null'},
    permission: PERM_EXECUTE,
    description:
        'Light.SetAll — set output/brightness on ALL Light components at once. At least one of on/brightness required.'
});

const LIGHT_METRICS: MetricDescriptor[] = [
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

b.setMetrics(LIGHT_METRICS);

export const LIGHT_DESCRIBE: DescribeOutput = b.build();
