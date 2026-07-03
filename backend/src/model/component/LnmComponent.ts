// LNM.* — Local Network Messaging (preview API).
// Dynamic component with Create/Delete; ids 200-299 per Shelly docs.

import type {DescribeOutput} from '../../rpc/describe';
import {
    LNM_CREATE_PARAMS_SCHEMA,
    LNM_DELETE_PARAMS_SCHEMA,
    LNM_DESCRIBE,
    LNM_GET_PARAMS_SCHEMA,
    LNM_SET_CONFIG_PARAMS_SCHEMA,
    type LnmCreateParams,
    type LnmDeleteParams,
    type LnmGetParams,
    type LnmSetConfigParams
} from '../../types/api/lnm';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class LnmComponent extends Component<any> {
    constructor() {
        super('lnm', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return LNM_DESCRIBE;
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetStatus(params: unknown) {
        return passthroughRpc<LnmGetParams>(params, {
            namespace: 'LNM',
            method: 'GetStatus',
            paramsSchema: LNM_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    rpcGetConfig(params: unknown) {
        return passthroughRpc<LnmGetParams>(params, {
            namespace: 'LNM',
            method: 'GetConfig',
            paramsSchema: LNM_GET_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<LnmSetConfigParams>(params, {
            namespace: 'LNM',
            method: 'SetConfig',
            paramsSchema: LNM_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, config: v.config})
        });
    }

    @Component.Expose('Create')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcCreate(params: unknown) {
        return passthroughRpc<LnmCreateParams>(params, {
            namespace: 'LNM',
            method: 'Create',
            paramsSchema: LNM_CREATE_PARAMS_SCHEMA,
            payload: (v) => ({
                config: v.config,
                ...(v.id !== undefined ? {id: v.id} : {})
            })
        });
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcDelete(params: unknown) {
        return passthroughRpc<LnmDeleteParams>(params, {
            namespace: 'LNM',
            method: 'Delete',
            paramsSchema: LNM_DELETE_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
