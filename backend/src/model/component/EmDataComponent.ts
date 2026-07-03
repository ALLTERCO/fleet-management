// EMData.* — triphase energy meter historical data.

import type {DescribeOutput} from '../../rpc/describe';
import {
    EMDATA_DELETE_ALL_DATA_PARAMS_SCHEMA,
    EMDATA_DESCRIBE,
    EMDATA_GET_CONFIG_PARAMS_SCHEMA,
    EMDATA_GET_DATA_PARAMS_SCHEMA,
    EMDATA_GET_NET_ENERGIES_PARAMS_SCHEMA,
    EMDATA_GET_RECORDS_PARAMS_SCHEMA,
    EMDATA_GET_STATUS_PARAMS_SCHEMA,
    EMDATA_RESET_COUNTERS_PARAMS_SCHEMA,
    EMDATA_SET_CONFIG_PARAMS_SCHEMA,
    type EmDataDeleteAllDataParams,
    type EmDataGetConfigParams,
    type EmDataGetDataParams,
    type EmDataGetNetEnergiesParams,
    type EmDataGetRecordsParams,
    type EmDataGetStatusParams,
    type EmDataResetCountersParams,
    type EmDataSetConfigParams
} from '../../types/api/emdata';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class EmDataComponent extends Component<any> {
    constructor() {
        super('emdata', {
            set_config_methods: false,
            auto_apply_config: false,
            // EMData.mdx → Notifications → Data. Fired on flush-to-flash.
            // Notification-only — `Webhook.ListAllSupported` omits it.
            events: [
                {
                    event: 'data',
                    attrs: [
                        {
                            name: 'data',
                            type: 'array',
                            desc: 'EMData.GetData-shaped flush record'
                        }
                    ]
                }
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return EMDATA_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<EmDataSetConfigParams>(params, {
            namespace: 'EMData',
            method: 'SetConfig',
            paramsSchema: EMDATA_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, config: v.config})
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetConfig(params: unknown) {
        return passthroughRpc<EmDataGetConfigParams>(params, {
            namespace: 'EMData',
            method: 'GetConfig',
            paramsSchema: EMDATA_GET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetStatus(params: unknown) {
        return passthroughRpc<EmDataGetStatusParams>(params, {
            namespace: 'EMData',
            method: 'GetStatus',
            paramsSchema: EMDATA_GET_STATUS_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetData')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    getData(params: unknown) {
        return passthroughRpc<EmDataGetDataParams>(params, {
            namespace: 'EMData',
            method: 'GetData',
            paramsSchema: EMDATA_GET_DATA_PARAMS_SCHEMA,
            payload: (v) => ({
                id: v.id,
                ts: v.ts,
                end_ts: v.end_ts,
                add_keys: v.add_keys
            })
        });
    }

    @Component.Expose('GetRecords')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    getRecords(params: unknown) {
        return passthroughRpc<EmDataGetRecordsParams>(params, {
            namespace: 'EMData',
            method: 'GetRecords',
            paramsSchema: EMDATA_GET_RECORDS_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, ts: v.ts})
        });
    }

    @Component.Expose('GetNetEnergies')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    getNetEnergies(params: unknown) {
        return passthroughRpc<EmDataGetNetEnergiesParams>(params, {
            namespace: 'EMData',
            method: 'GetNetEnergies',
            paramsSchema: EMDATA_GET_NET_ENERGIES_PARAMS_SCHEMA,
            payload: (v) => ({
                id: v.id,
                ts: v.ts,
                period: v.period,
                end_ts: v.end_ts,
                add_keys: v.add_keys
            })
        });
    }

    @Component.Expose('ResetCounters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    resetCounters(params: unknown) {
        return passthroughRpc<EmDataResetCountersParams>(params, {
            namespace: 'EMData',
            method: 'ResetCounters',
            paramsSchema: EMDATA_RESET_COUNTERS_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('DeleteAllData')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    deleteAllData(params: unknown) {
        return passthroughRpc<EmDataDeleteAllDataParams>(params, {
            namespace: 'EMData',
            method: 'DeleteAllData',
            paramsSchema: EMDATA_DELETE_ALL_DATA_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
