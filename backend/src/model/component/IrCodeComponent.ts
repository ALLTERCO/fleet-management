// IRCode.* — IR code namespace of the pre-market IR Controller (app IRG4).
// Thin passthrough only; the preview firmware documents no param shapes, so
// the device-defined payload travels through unchanged.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    IRCODE_DESCRIBE,
    IRCODE_EMIT_PARAMS_SCHEMA,
    IRCODE_GET_CONFIG_PARAMS_SCHEMA,
    IRCODE_GET_STATUS_PARAMS_SCHEMA,
    IRCODE_SET_CONFIG_PARAMS_SCHEMA,
    type IrCodeEmitParams,
    type IrCodeGetConfigParams,
    type IrCodeGetStatusParams,
    type IrCodeSetConfigParams
} from '../../types/api/ircode';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class IrCodeComponent extends Component<any> {
    constructor() {
        super('ircode', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return IRCODE_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<IrCodeGetConfigParams>(
            params,
            IRCODE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRCode.GetConfig', () =>
            device.sendRPC('IRCode.GetConfig', v.params ?? {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<IrCodeGetStatusParams>(
            params,
            IRCODE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRCode.GetStatus', () =>
            device.sendRPC('IRCode.GetStatus', v.params ?? {})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<IrCodeSetConfigParams>(
            params,
            IRCODE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRCode.SetConfig', () =>
            device.sendRPC('IRCode.SetConfig', v.params ?? {})
        );
    }

    @Component.Expose('Emit')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async rpcEmit(params: unknown) {
        const v = validateOrThrow<IrCodeEmitParams>(
            params,
            IRCODE_EMIT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRCode.Emit', () =>
            device.sendRPC('IRCode.Emit', v.params ?? {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
