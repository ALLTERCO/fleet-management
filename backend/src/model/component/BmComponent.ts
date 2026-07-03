// BM.* — Battery Monitor pass-through.

import type {DescribeOutput} from '../../rpc/describe';
import {
    BM_DESCRIBE,
    BM_GET_PARAMS_SCHEMA,
    BM_SET_CONFIG_PARAMS_SCHEMA,
    type BmGetParams,
    type BmSetConfigParams
} from '../../types/api/bm';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class BmComponent extends Component<any> {
    constructor() {
        super('bm', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BM_DESCRIBE;
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetStatus(params: unknown) {
        return passthroughRpc<BmGetParams>(params, {
            namespace: 'BM',
            method: 'GetStatus',
            paramsSchema: BM_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetConfig(params: unknown) {
        return passthroughRpc<BmGetParams>(params, {
            namespace: 'BM',
            method: 'GetConfig',
            paramsSchema: BM_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<BmSetConfigParams>(params, {
            namespace: 'BM',
            method: 'SetConfig',
            paramsSchema: BM_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, config: v.config})
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
