// CB.* — Circuit Breaker pass-through (Pro CB and similar).

import type {DescribeOutput} from '../../rpc/describe';
import {
    CB_DESCRIBE,
    CB_GET_PARAMS_SCHEMA,
    CB_SET_CONFIG_PARAMS_SCHEMA,
    type CbGetParams,
    type CbSetConfigParams
} from '../../types/api/cb';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class CbComponent extends Component<any> {
    constructor() {
        super('cb', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return CB_DESCRIBE;
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetStatus(params: unknown) {
        return passthroughRpc<CbGetParams>(params, {
            namespace: 'CB',
            method: 'GetStatus',
            paramsSchema: CB_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetConfig(params: unknown) {
        return passthroughRpc<CbGetParams>(params, {
            namespace: 'CB',
            method: 'GetConfig',
            paramsSchema: CB_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<CbSetConfigParams>(params, {
            namespace: 'CB',
            method: 'SetConfig',
            paramsSchema: CB_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, config: v.config})
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
