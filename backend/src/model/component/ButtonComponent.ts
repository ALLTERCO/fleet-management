// Virtual Button.* — logical button aggregator (BLU-sourced or scripted).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BUTTON_DESCRIBE,
    BUTTON_GET_CONFIG_PARAMS_SCHEMA,
    BUTTON_GET_STATUS_PARAMS_SCHEMA,
    BUTTON_SET_CONFIG_PARAMS_SCHEMA,
    BUTTON_TRIGGER_PARAMS_SCHEMA,
    type ButtonGetConfigParams,
    type ButtonGetStatusParams,
    type ButtonSetConfigParams,
    type ButtonTriggerParams
} from '../../types/api/button';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class ButtonComponent extends Component<any> {
    constructor() {
        super('button', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BUTTON_DESCRIBE;
    }

    @Component.Expose('Trigger')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async trigger(params: unknown) {
        const v = validateOrThrow<ButtonTriggerParams>(
            params,
            BUTTON_TRIGGER_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Button.Trigger', () =>
            device.sendRPC('Button.Trigger', {id: v.id, event: v.event})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<ButtonSetConfigParams>(
            params,
            BUTTON_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Button.SetConfig', () =>
            device.sendRPC('Button.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<ButtonGetConfigParams>(
            params,
            BUTTON_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Button.GetConfig', () =>
            device.sendRPC('Button.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<ButtonGetStatusParams>(
            params,
            BUTTON_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Button.GetStatus', () =>
            device.sendRPC('Button.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
