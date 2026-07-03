// Temperature.* — temperature sensor component.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    TEMPERATURE_DESCRIBE,
    TEMPERATURE_GET_CONFIG_PARAMS_SCHEMA,
    TEMPERATURE_GET_STATUS_PARAMS_SCHEMA,
    TEMPERATURE_SET_CONFIG_PARAMS_SCHEMA,
    type TemperatureGetConfigParams,
    type TemperatureGetStatusParams,
    type TemperatureSetConfigParams
} from '../../types/api/temperature';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class TemperatureComponent extends Component<any> {
    constructor() {
        super('temperature', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return TEMPERATURE_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<TemperatureSetConfigParams>(
            params,
            TEMPERATURE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Temperature.SetConfig', () =>
            device.sendRPC('Temperature.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<TemperatureGetConfigParams>(
            params,
            TEMPERATURE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Temperature.GetConfig', () =>
            device.sendRPC('Temperature.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<TemperatureGetStatusParams>(
            params,
            TEMPERATURE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Temperature.GetStatus', () =>
            device.sendRPC('Temperature.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
