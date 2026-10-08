// IR.* — pre-market IR Controller (app IRG4) top-level namespace. Thin
// passthrough only; the firmware contract is preview and undocumented, so
// nothing is interpreted here.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    IR_ADD_DEVICE_PARAMS_SCHEMA,
    IR_DELETE_DEVICE_PARAMS_SCHEMA,
    IR_DESCRIBE,
    IR_GET_CONFIG_PARAMS_SCHEMA,
    IR_GET_STATUS_PARAMS_SCHEMA,
    IR_SET_CONFIG_PARAMS_SCHEMA,
    type IrAddDeviceParams,
    type IrDeleteDeviceParams,
    type IrGetConfigParams,
    type IrGetStatusParams,
    type IrSetConfigParams
} from '../../types/api/ir';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class IrComponent extends Component<any> {
    constructor() {
        super('ir', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return IR_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<IrGetConfigParams>(
            params,
            IR_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IR.GetConfig', () =>
            device.sendRPC('IR.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<IrGetStatusParams>(
            params,
            IR_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IR.GetStatus', () =>
            device.sendRPC('IR.GetStatus', {})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<IrSetConfigParams>(
            params,
            IR_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IR.SetConfig', () =>
            device.sendRPC('IR.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('AddDevice')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async rpcAddDevice(params: unknown) {
        const v = validateOrThrow<IrAddDeviceParams>(
            params,
            IR_ADD_DEVICE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IR.AddDevice', () =>
            device.sendRPC('IR.AddDevice', v.params ?? {})
        );
    }

    @Component.Expose('DeleteDevice')
    @Component.CrudPermission('devices', 'delete', (p) => p?.shellyID)
    async rpcDeleteDevice(params: unknown) {
        const v = validateOrThrow<IrDeleteDeviceParams>(
            params,
            IR_DELETE_DEVICE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IR.DeleteDevice', () =>
            device.sendRPC('IR.DeleteDevice', v.params ?? {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
