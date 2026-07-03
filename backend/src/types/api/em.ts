// EM.* — triphase energy meter (per official Shelly Gen2+ docs).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {electrical} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const P_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};
// EM.PhaseToPhaseCalib — verified live: device accepts `from`/`to`, not
// `phase_from`/`phase_to`.
const P_PHASE_TO_PHASE_CALIB: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'from', 'to'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        from: {type: 'string'},
        to: {type: 'string'}
    }
};
// EM.PhaseToPhaseCalibReset — per-phase (verified live).
const P_PHASE_TO_PHASE_CALIB_RESET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'phase'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        phase: {type: 'string'}
    }
};

const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const RESP_NULL: JsonSchema = {type: 'null'};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};
const RESP_CT_TYPES: JsonSchema = {
    type: 'object',
    required: ['supported'],
    properties: {supported: {type: 'array', items: {type: 'string'}}}
};

export interface EmSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const EM_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface EmGetConfigParams {
    shellyID: string;
    id: number;
}
export const EM_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface EmGetStatusParams {
    shellyID: string;
    id: number;
}
export const EM_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface EmGetCTTypesParams {
    shellyID: string;
    id: number;
}
export const EM_GET_CT_TYPES_PARAMS_SCHEMA = P_ID;

export interface EmPhaseToPhaseCalibParams {
    shellyID: string;
    id: number;
    from: string;
    to: string;
}
export const EM_PHASE_TO_PHASE_CALIB_PARAMS_SCHEMA = P_PHASE_TO_PHASE_CALIB;

export interface EmPhaseToPhaseCalibResetParams {
    shellyID: string;
    id: number;
    phase: string;
}
export const EM_PHASE_TO_PHASE_CALIB_RESET_PARAMS_SCHEMA =
    P_PHASE_TO_PHASE_CALIB_RESET;

const b = new DescribeBuilder('em', {
    kind: 'device',
    description: 'Configure and read a triphase energy meter on a device.'
});

b.registerMethod('SetConfig', {
    params: EM_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'EM.SetConfig — triphase energy meter config.'
});
b.registerMethod('GetConfig', {
    params: EM_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: EM_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM.GetStatus.'
});
b.registerMethod('GetCTTypes', {
    params: EM_GET_CT_TYPES_PARAMS_SCHEMA,
    response: RESP_CT_TYPES,
    permission: PERM_READ,
    description: 'EM.GetCTTypes — supported current-transformer types.'
});
b.registerMethod('PhaseToPhaseCalib', {
    params: EM_PHASE_TO_PHASE_CALIB_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description:
        'EM.PhaseToPhaseCalib — phases must carry equal voltage and a minimum load.'
});
b.registerMethod('PhaseToPhaseCalibReset', {
    params: EM_PHASE_TO_PHASE_CALIB_RESET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description: 'EM.PhaseToPhaseCalibReset — clears one phase calibration.'
});

// Triphase EM status fields (EM.GetStatus). Phases are field prefixes a_/b_/c_
// on a single instance; firmware also reports total_* across phases.
const EM_METRICS: MetricDescriptor[] = [
    ...(['A', 'B', 'C'] as const).flatMap((phase) => {
        const p = phase.toLowerCase();
        return [
            electrical(`${p}_current`, 'current', {phase}),
            electrical(`${p}_voltage`, 'voltage', {phase}),
            electrical(`${p}_act_power`, 'active_power', {phase}),
            electrical(`${p}_aprt_power`, 'apparent_power', {phase}),
            electrical(`${p}_pf`, 'power_factor', {phase}),
            electrical(`${p}_freq`, 'frequency', {phase})
        ];
    }),
    electrical('n_current', 'current', {phase: 'N', optional: true}),
    electrical('total_current', 'current', {phase: 'total'}),
    electrical('total_act_power', 'active_power', {
        phase: 'total',
        total: true,
        direction: 'net'
    }),
    electrical('total_aprt_power', 'apparent_power', {
        phase: 'total',
        total: true
    })
];

b.setMetrics(EM_METRICS);

export const EM_DESCRIBE: DescribeOutput = b.build();
