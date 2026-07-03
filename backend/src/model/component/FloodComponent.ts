// Flood.* — flood/leak sensor.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    FLOOD_DESCRIBE,
    FLOOD_GET_CONFIG_PARAMS_SCHEMA,
    FLOOD_GET_STATUS_PARAMS_SCHEMA,
    FLOOD_SET_CONFIG_PARAMS_SCHEMA,
    type FloodGetConfigParams,
    type FloodGetStatusParams,
    type FloodSetConfigParams
} from '../../types/api/flood';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class FloodComponent extends Component<any> {
    constructor() {
        super('flood', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return FLOOD_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<FloodSetConfigParams>(
            params,
            FLOOD_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Flood.SetConfig', () =>
            device.sendRPC('Flood.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<FloodGetConfigParams>(
            params,
            FLOOD_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Flood.GetConfig', () =>
            device.sendRPC('Flood.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<FloodGetStatusParams>(
            params,
            FLOOD_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Flood.GetStatus', () =>
            device.sendRPC('Flood.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
