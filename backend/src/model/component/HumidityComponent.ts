// Humidity.* — humidity sensor component.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    HUMIDITY_DESCRIBE,
    HUMIDITY_GET_CONFIG_PARAMS_SCHEMA,
    HUMIDITY_GET_STATUS_PARAMS_SCHEMA,
    HUMIDITY_SET_CONFIG_PARAMS_SCHEMA,
    type HumidityGetConfigParams,
    type HumidityGetStatusParams,
    type HumiditySetConfigParams
} from '../../types/api/humidity';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class HumidityComponent extends Component<any> {
    constructor() {
        super('humidity', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return HUMIDITY_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<HumiditySetConfigParams>(
            params,
            HUMIDITY_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Humidity.SetConfig', () =>
            device.sendRPC('Humidity.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<HumidityGetConfigParams>(
            params,
            HUMIDITY_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Humidity.GetConfig', () =>
            device.sendRPC('Humidity.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<HumidityGetStatusParams>(
            params,
            HUMIDITY_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Humidity.GetStatus', () =>
            device.sendRPC('Humidity.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
