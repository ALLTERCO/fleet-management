// Device-side Script.* — mJS scripting (Gen2+).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SCRIPT_CREATE_PARAMS_SCHEMA,
    SCRIPT_DESCRIBE,
    SCRIPT_EVAL_PARAMS_SCHEMA,
    SCRIPT_GET_CODE_PARAMS_SCHEMA,
    SCRIPT_ID_PARAMS_SCHEMA,
    SCRIPT_LIST_PARAMS_SCHEMA,
    SCRIPT_PUT_CODE_PARAMS_SCHEMA,
    SCRIPT_SET_CONFIG_PARAMS_SCHEMA,
    type ScriptCreateParams,
    type ScriptEvalParams,
    type ScriptGetCodeParams,
    type ScriptIdParams,
    type ScriptListParams,
    type ScriptPutCodeParams,
    type ScriptSetConfigParams
} from '../../types/api/script';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class ScriptComponent extends Component<any> {
    constructor() {
        super('script', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SCRIPT_DESCRIBE;
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async list(params: unknown) {
        const v = validateOrThrow<ScriptListParams>(
            params,
            SCRIPT_LIST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.List', () =>
            device.sendRPC('Script.List', {})
        );
    }

    @Component.Expose('Create')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async create(params: unknown) {
        const v = validateOrThrow<ScriptCreateParams>(
            params,
            SCRIPT_CREATE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.Create', () =>
            device.sendRPC('Script.Create', {name: v.name})
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async delete(params: unknown) {
        const v = validateOrThrow<ScriptIdParams>(
            params,
            SCRIPT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.Delete', () =>
            device.sendRPC('Script.Delete', {id: v.id})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<ScriptIdParams>(
            params,
            SCRIPT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.GetConfig', () =>
            device.sendRPC('Script.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<ScriptSetConfigParams>(
            params,
            SCRIPT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.SetConfig', () =>
            device.sendRPC('Script.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<ScriptIdParams>(
            params,
            SCRIPT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.GetStatus', () =>
            device.sendRPC('Script.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('GetCode')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getCode(params: unknown) {
        const v = validateOrThrow<ScriptGetCodeParams>(
            params,
            SCRIPT_GET_CODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.GetCode', () =>
            device.sendRPC('Script.GetCode', {
                id: v.id,
                offset: v.offset,
                len: v.len
            })
        );
    }

    @Component.Expose('PutCode')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putCode(params: unknown) {
        const v = validateOrThrow<ScriptPutCodeParams>(
            params,
            SCRIPT_PUT_CODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.PutCode', () =>
            device.sendRPC('Script.PutCode', {
                id: v.id,
                code: v.code,
                offset: v.offset,
                append: v.append
            })
        );
    }

    @Component.Expose('Start')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async start(params: unknown) {
        const v = validateOrThrow<ScriptIdParams>(
            params,
            SCRIPT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.Start', () =>
            device.sendRPC('Script.Start', {id: v.id})
        );
    }

    @Component.Expose('Stop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async stop(params: unknown) {
        const v = validateOrThrow<ScriptIdParams>(
            params,
            SCRIPT_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.Stop', () =>
            device.sendRPC('Script.Stop', {id: v.id})
        );
    }

    @Component.Expose('Eval')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async eval(params: unknown) {
        const v = validateOrThrow<ScriptEvalParams>(
            params,
            SCRIPT_EVAL_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Script.Eval', () =>
            device.sendRPC('Script.Eval', {id: v.id, code: v.code})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
