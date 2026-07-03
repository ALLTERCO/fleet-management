// DevicePower.* — battery / external power state.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    DEVICEPOWER_DESCRIBE,
    DEVICEPOWER_GET_CONFIG_PARAMS_SCHEMA,
    DEVICEPOWER_GET_STATUS_PARAMS_SCHEMA,
    DEVICEPOWER_SET_CONFIG_PARAMS_SCHEMA,
    type DevicePowerGetConfigParams,
    type DevicePowerGetStatusParams,
    type DevicePowerSetConfigParams
} from '../../types/api/devicepower';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class DevicePowerComponent extends Component<any> {
    constructor() {
        super('devicepower', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return DEVICEPOWER_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<DevicePowerSetConfigParams>(
            params,
            DEVICEPOWER_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('DevicePower.SetConfig', () =>
            device.sendRPC('DevicePower.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<DevicePowerGetConfigParams>(
            params,
            DEVICEPOWER_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('DevicePower.GetConfig', () =>
            device.sendRPC('DevicePower.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<DevicePowerGetStatusParams>(
            params,
            DEVICEPOWER_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('DevicePower.GetStatus', () =>
            device.sendRPC('DevicePower.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
