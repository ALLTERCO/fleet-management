// EMData.* — triphase energy meter historical data (per official Shelly docs).

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
// EMData.GetData — required {id, ts}, optional {end_ts, add_keys}.
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
// EMData.GetRecords — required {id}, optional {ts}.
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
// EMData.GetNetEnergies — required {id, ts, period}, optional {end_ts, add_keys}.
// period must be 300 / 900 / 1800 / 3600 (device-validated).
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

export interface EmDataSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const EMDATA_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface EmDataGetConfigParams {
    shellyID: string;
    id: number;
}
export const EMDATA_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface EmDataGetStatusParams {
    shellyID: string;
    id: number;
}
export const EMDATA_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface EmDataGetDataParams {
    shellyID: string;
    id: number;
    ts: number;
    end_ts?: number;
    add_keys?: boolean;
}
export const EMDATA_GET_DATA_PARAMS_SCHEMA = P_GET_DATA;

export interface EmDataGetRecordsParams {
    shellyID: string;
    id: number;
    ts?: number;
}
export const EMDATA_GET_RECORDS_PARAMS_SCHEMA = P_GET_RECORDS;

export interface EmDataGetNetEnergiesParams {
    shellyID: string;
    id: number;
    ts: number;
    period: number;
    end_ts?: number;
    add_keys?: boolean;
}
export const EMDATA_GET_NET_ENERGIES_PARAMS_SCHEMA = P_NET_ENERGIES;

export interface EmDataResetCountersParams {
    shellyID: string;
    id: number;
}
export const EMDATA_RESET_COUNTERS_PARAMS_SCHEMA = P_ID;

export interface EmDataDeleteAllDataParams {
    shellyID: string;
    id: number;
}
export const EMDATA_DELETE_ALL_DATA_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('emdata', {
    kind: 'device',
    description:
        'Read and manage stored triphase energy-meter history on a device.'
});

b.registerMethod('SetConfig', {
    params: EMDATA_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'EMData.SetConfig.'
});
b.registerMethod('GetConfig', {
    params: EMDATA_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EMData.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: EMDATA_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EMData.GetStatus.'
});
b.registerMethod('GetData', {
    params: EMDATA_GET_DATA_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'EMData.GetData — saved emeter data values. {keys, data:[{ts, period, values}]}.'
});
b.registerMethod('GetRecords', {
    params: EMDATA_GET_RECORDS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EMData.GetRecords — saved emeter data time intervals.'
});
b.registerMethod('GetNetEnergies', {
    params: EMDATA_GET_NET_ENERGIES_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'EMData.GetNetEnergies — period must be 300/900/1800/3600 (device-validated).'
});
b.registerMethod('ResetCounters', {
    params: EMDATA_RESET_COUNTERS_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description: 'EMData.ResetCounters.'
});
b.registerMethod('DeleteAllData', {
    params: EMDATA_DELETE_ALL_DATA_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description:
        'EMData.DeleteAllData — wipes device-side history (irreversible).'
});

const EMDATA_METRICS: MetricDescriptor[] = [
    ...(['A', 'B', 'C'] as const).flatMap((phase) => {
        const p = phase.toLowerCase();
        return [
            electrical(`${p}_total_act_energy`, 'active_energy', {
                phase,
                direction: 'import'
            }),
            electrical(`${p}_total_act_ret_energy`, 'active_energy', {
                phase,
                direction: 'export'
            })
        ];
    }),
    electrical('total_act', 'active_energy', {
        phase: 'total',
        direction: 'import'
    }),
    electrical('total_act_ret', 'active_energy', {
        phase: 'total',
        direction: 'export'
    })
];

b.setMetrics(EMDATA_METRICS);

export const EMDATA_DESCRIBE: DescribeOutput = b.build();
