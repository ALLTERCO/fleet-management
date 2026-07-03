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
// Device-validated fields (ranges enforced by firmware).
const P_OPEN_CLOSE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: true,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        duration: {
            type: 'integer',
            description: 'Seconds to run (device-validated).'
        }
    }
};
const P_GOTO: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: true,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        pos: {
            type: 'integer',
            description: 'Target position 0..100 (device-validated).'
        },
        slat_pos: {
            type: 'integer',
            description: 'Target slat 0..100 (device-validated).'
        }
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

const b = new DescribeBuilder('cover', {
    kind: 'device',
    description:
        'Control and monitor cover/roller-shutter position, slats, and calibration.'
});

b.registerMethod('Open', {
    params: P_OPEN_CLOSE,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Cover.Open — optional duration in seconds.'
});
b.registerMethod('Close', {
    params: P_OPEN_CLOSE,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Cover.Close — optional duration in seconds.'
});
b.registerMethod('Stop', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Cover.Stop.'
});
b.registerMethod('GoToPosition', {
    params: P_GOTO,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Cover.GoToPosition — pos and/or slat_pos.'
});
b.registerMethod('Calibrate', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Cover.Calibrate.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Cover.SetConfig.'
});
b.registerMethod('ResetCounters', {
    params: P_RESET,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Cover.ResetCounters.'
});
b.registerMethod('GetConfig', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Cover.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Cover.GetStatus.'
});

const COVER_METRICS: MetricDescriptor[] = [
    electrical('apower', 'active_power'),
    electrical('voltage', 'voltage'),
    electrical('current', 'current'),
    electrical('pf', 'power_factor'),
    electrical('freq', 'frequency'),
    electrical('aenergy_total', 'active_energy', {direction: 'import'}),
    sensor('current_pos', '%', {optional: true}),
    sensor('target_pos', '%', {optional: true}),
    sensor('slat_pos', '%', {optional: true}),
    sensor('temperature_tc', '°C', {optional: true}),
    sensor('temperature_tf', '°F', {optional: true})
];

b.setMetrics(COVER_METRICS);

export const COVER_DESCRIBE: DescribeOutput = b.build();

// Public typed exports for component handlers.
export interface CoverGetConfigParams {
    shellyID: string;
    id: number;
}
export const COVER_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface CoverGetStatusParams {
    shellyID: string;
    id: number;
}
export const COVER_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface CoverIdParams {
    shellyID: string;
    id: number;
}
export const COVER_ID_PARAMS_SCHEMA = P_ID;

export interface CoverOpenCloseParams {
    shellyID: string;
    id: number;
    duration?: number;
}
export const COVER_OPEN_CLOSE_PARAMS_SCHEMA = P_OPEN_CLOSE;

export interface CoverGoToPositionParams {
    shellyID: string;
    id: number;
    pos?: number;
    slat_pos?: number;
}
export const COVER_GO_TO_POSITION_PARAMS_SCHEMA = P_GOTO;

export interface CoverSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const COVER_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface CoverResetCountersParams {
    shellyID: string;
    id: number;
    types?: string[];
}
export const COVER_RESET_COUNTERS_PARAMS_SCHEMA = P_RESET;
