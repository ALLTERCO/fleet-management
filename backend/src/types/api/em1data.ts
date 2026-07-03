// EM1Data.* — monophase energy meter historical data (per official Shelly docs).

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
const P_GET_DATA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'ts'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        ts: {type: 'integer'},
        end_ts: {type: 'integer'},
        add_keys: {type: 'boolean'}
    }
};
const P_GET_RECORDS: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        ts: {type: 'integer'}
    }
};
const P_NET_ENERGIES: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'ts', 'period'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        ts: {type: 'integer'},
        period: {type: 'integer'},
        end_ts: {type: 'integer'},
        add_keys: {type: 'boolean'}
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

export interface Em1DataSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const EM1DATA_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface Em1DataGetConfigParams {
    shellyID: string;
    id: number;
}
export const EM1DATA_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface Em1DataGetStatusParams {
    shellyID: string;
    id: number;
}
export const EM1DATA_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface Em1DataGetDataParams {
    shellyID: string;
    id: number;
    ts: number;
    end_ts?: number;
    add_keys?: boolean;
}
export const EM1DATA_GET_DATA_PARAMS_SCHEMA = P_GET_DATA;

export interface Em1DataGetRecordsParams {
    shellyID: string;
    id: number;
    ts?: number;
}
export const EM1DATA_GET_RECORDS_PARAMS_SCHEMA = P_GET_RECORDS;

export interface Em1DataGetNetEnergiesParams {
    shellyID: string;
    id: number;
    ts: number;
    period: number;
    end_ts?: number;
    add_keys?: boolean;
}
export const EM1DATA_GET_NET_ENERGIES_PARAMS_SCHEMA = P_NET_ENERGIES;

export interface Em1DataResetCountersParams {
    shellyID: string;
    id: number;
}
export const EM1DATA_RESET_COUNTERS_PARAMS_SCHEMA = P_ID;

export interface Em1DataDeleteAllDataParams {
    shellyID: string;
    id: number;
}
export const EM1DATA_DELETE_ALL_DATA_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('em1data', {
    kind: 'device',
    description:
        'Read and manage stored monophase energy-meter history on a device.'
});

b.registerMethod('SetConfig', {
    params: EM1DATA_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'EM1Data.SetConfig.'
});
b.registerMethod('GetConfig', {
    params: EM1DATA_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM1Data.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: EM1DATA_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM1Data.GetStatus.'
});
b.registerMethod('GetData', {
    params: EM1DATA_GET_DATA_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM1Data.GetData — saved emeter data values.'
});
b.registerMethod('GetRecords', {
    params: EM1DATA_GET_RECORDS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM1Data.GetRecords — saved emeter data time intervals.'
});
b.registerMethod('GetNetEnergies', {
    params: EM1DATA_GET_NET_ENERGIES_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'EM1Data.GetNetEnergies — period must be 300/900/1800/3600 (device-validated).'
});
b.registerMethod('ResetCounters', {
    params: EM1DATA_RESET_COUNTERS_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description: 'EM1Data.ResetCounters.'
});
b.registerMethod('DeleteAllData', {
    params: EM1DATA_DELETE_ALL_DATA_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description:
        'EM1Data.DeleteAllData — wipes device-side history (irreversible).'
});

const EM1DATA_METRICS: MetricDescriptor[] = [
    electrical('total_act_energy', 'active_energy', {direction: 'import'}),
    electrical('total_act_ret_energy', 'active_energy', {direction: 'export'})
];

b.setMetrics(EM1DATA_METRICS);

export const EM1DATA_DESCRIBE: DescribeOutput = b.build();
