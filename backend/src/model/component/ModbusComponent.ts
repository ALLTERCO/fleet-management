// Modbus.* — device-side Modbus TCP/RTU connector.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MODBUS_DESCRIBE,
    MODBUS_GET_CONFIG_PARAMS_SCHEMA,
    MODBUS_GET_STATUS_PARAMS_SCHEMA,
    MODBUS_SET_CONFIG_PARAMS_SCHEMA,
    type ModbusGetConfigParams,
    type ModbusGetStatusParams,
    type ModbusSetConfigParams
} from '../../types/api/modbus';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class ModbusComponent extends Component<any> {
    constructor() {
        super('modbus', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return MODBUS_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<ModbusSetConfigParams>(
            params,
            MODBUS_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Modbus.SetConfig', () =>
            device.sendRPC('Modbus.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<ModbusGetConfigParams>(
            params,
            MODBUS_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Modbus.GetConfig', () =>
            device.sendRPC('Modbus.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<ModbusGetStatusParams>(
            params,
            MODBUS_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Modbus.GetStatus', () =>
            device.sendRPC('Modbus.GetStatus', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
