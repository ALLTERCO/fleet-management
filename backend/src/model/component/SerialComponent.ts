// Serial.* — Pro line serial port.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SERIAL_DESCRIBE,
    SERIAL_GET_CONFIG_PARAMS_SCHEMA,
    SERIAL_SET_CONFIG_PARAMS_SCHEMA,
    type SerialGetConfigParams,
    type SerialSetConfigParams
} from '../../types/api/serial';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class SerialComponent extends Component<any> {
    constructor() {
        super('serial', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SERIAL_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<SerialSetConfigParams>(
            params,
            SERIAL_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Serial.SetConfig', () =>
            device.sendRPC('Serial.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<SerialGetConfigParams>(
            params,
            SERIAL_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Serial.GetConfig', () =>
            device.sendRPC('Serial.GetConfig', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
