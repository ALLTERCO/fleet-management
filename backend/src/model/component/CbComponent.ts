// CB.* — Circuit Breaker pass-through (Pro CB and similar).

import type {DescribeOutput} from '../../rpc/describe';
import {
    CB_DESCRIBE,
    CB_GET_PARAMS_SCHEMA,
    CB_GETLOG_PARAMS_SCHEMA,
    CB_SET_CONFIG_PARAMS_SCHEMA,
    CB_SET_PARAMS_SCHEMA,
    type CbGetLogParams,
    type CbGetParams,
    type CbSetConfigParams,
    type CbSetParams
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

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    rpcSet(params: unknown) {
        return passthroughRpc<CbSetParams>(params, {
            namespace: 'CB',
            method: 'Set',
            paramsSchema: CB_SET_PARAMS_SCHEMA,
            // output true = engage, false = disengage. The device gates remote
            // re-engage while safety-latched; FM does not second-guess it.
            payload: (v) => ({id: v.id, output: v.output})
        });
    }

    @Component.Expose('GetLog')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetLog(params: unknown) {
        return passthroughRpc<CbGetLogParams>(params, {
            namespace: 'CB',
            method: 'GetLog',
            paramsSchema: CB_GETLOG_PARAMS_SCHEMA,
            payload: (v) =>
                v.after !== undefined ? {id: v.id, after: v.after} : {id: v.id}
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
