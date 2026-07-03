// Fan.* — Fan pass-through (set on/off, set speed).

import type {DescribeOutput} from '../../rpc/describe';
import {
    FAN_DESCRIBE,
    FAN_GET_PARAMS_SCHEMA,
    FAN_SET_CONFIG_PARAMS_SCHEMA,
    FAN_SET_PARAMS_SCHEMA,
    type FanGetParams,
    type FanSetConfigParams,
    type FanSetParams
} from '../../types/api/fan';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class FanComponent extends Component<any> {
    constructor() {
        super('fan', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return FAN_DESCRIBE;
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetStatus(params: unknown) {
        return passthroughRpc<FanGetParams>(params, {
            namespace: 'Fan',
            method: 'GetStatus',
            paramsSchema: FAN_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetConfig(params: unknown) {
        return passthroughRpc<FanGetParams>(params, {
            namespace: 'Fan',
            method: 'GetConfig',
            paramsSchema: FAN_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<FanSetConfigParams>(params, {
            namespace: 'Fan',
            method: 'SetConfig',
            paramsSchema: FAN_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, config: v.config})
        });
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSet(params: unknown) {
        return passthroughRpc<FanSetParams>(params, {
            namespace: 'Fan',
            method: 'Set',
            paramsSchema: FAN_SET_PARAMS_SCHEMA,
            payload: (v) => ({
                id: v.id,
                ...(v.on !== undefined ? {on: v.on} : {}),
                ...(v.speed !== undefined ? {speed: v.speed} : {})
            })
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
