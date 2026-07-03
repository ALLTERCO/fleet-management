// EM1Data.* — monophase energy meter historical data.

import type {DescribeOutput} from '../../rpc/describe';
import {
    EM1DATA_DELETE_ALL_DATA_PARAMS_SCHEMA,
    EM1DATA_DESCRIBE,
    EM1DATA_GET_CONFIG_PARAMS_SCHEMA,
    EM1DATA_GET_DATA_PARAMS_SCHEMA,
    EM1DATA_GET_NET_ENERGIES_PARAMS_SCHEMA,
    EM1DATA_GET_RECORDS_PARAMS_SCHEMA,
    EM1DATA_GET_STATUS_PARAMS_SCHEMA,
    EM1DATA_RESET_COUNTERS_PARAMS_SCHEMA,
    EM1DATA_SET_CONFIG_PARAMS_SCHEMA,
    type Em1DataDeleteAllDataParams,
    type Em1DataGetConfigParams,
    type Em1DataGetDataParams,
    type Em1DataGetNetEnergiesParams,
    type Em1DataGetRecordsParams,
    type Em1DataGetStatusParams,
    type Em1DataResetCountersParams,
    type Em1DataSetConfigParams
} from '../../types/api/em1data';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class Em1DataComponent extends Component<any> {
    constructor() {
        super('em1data', {
            set_config_methods: false,
            auto_apply_config: false,
            // EM1Data.mdx → Notifications → Data. Fired on flush-to-flash.
            // Notification-only — `Webhook.ListAllSupported` omits it.
            events: [
                {
                    event: 'data',
                    attrs: [
                        {
                            name: 'data',
                            type: 'array',
                            desc: 'EM1Data.GetData-shaped flush record'
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
        return EM1DATA_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<Em1DataSetConfigParams>(params, {
            namespace: 'EM1Data',
            method: 'SetConfig',
            paramsSchema: EM1DATA_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, config: v.config})
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetConfig(params: unknown) {
        return passthroughRpc<Em1DataGetConfigParams>(params, {
            namespace: 'EM1Data',
            method: 'GetConfig',
            paramsSchema: EM1DATA_GET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetStatus(params: unknown) {
        return passthroughRpc<Em1DataGetStatusParams>(params, {
            namespace: 'EM1Data',
            method: 'GetStatus',
            paramsSchema: EM1DATA_GET_STATUS_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetData')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    getData(params: unknown) {
        return passthroughRpc<Em1DataGetDataParams>(params, {
            namespace: 'EM1Data',
            method: 'GetData',
            paramsSchema: EM1DATA_GET_DATA_PARAMS_SCHEMA,
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
        return passthroughRpc<Em1DataGetRecordsParams>(params, {
            namespace: 'EM1Data',
            method: 'GetRecords',
            paramsSchema: EM1DATA_GET_RECORDS_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, ts: v.ts})
        });
    }

    @Component.Expose('GetNetEnergies')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    getNetEnergies(params: unknown) {
        return passthroughRpc<Em1DataGetNetEnergiesParams>(params, {
            namespace: 'EM1Data',
            method: 'GetNetEnergies',
            paramsSchema: EM1DATA_GET_NET_ENERGIES_PARAMS_SCHEMA,
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
        return passthroughRpc<Em1DataResetCountersParams>(params, {
            namespace: 'EM1Data',
            method: 'ResetCounters',
            paramsSchema: EM1DATA_RESET_COUNTERS_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('DeleteAllData')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    deleteAllData(params: unknown) {
        return passthroughRpc<Em1DataDeleteAllDataParams>(params, {
            namespace: 'EM1Data',
            method: 'DeleteAllData',
            paramsSchema: EM1DATA_DELETE_ALL_DATA_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
