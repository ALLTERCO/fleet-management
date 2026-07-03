// Mqtt.* — device-side MQTT client.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MQTT_DESCRIBE,
    MQTT_GET_CONFIG_PARAMS_SCHEMA,
    MQTT_GET_STATUS_PARAMS_SCHEMA,
    MQTT_SET_CONFIG_PARAMS_SCHEMA,
    type MqttGetConfigParams,
    type MqttGetStatusParams,
    type MqttSetConfigParams
} from '../../types/api/mqtt';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class MqttComponent extends Component<any> {
    constructor() {
        super('mqtt', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return MQTT_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<MqttSetConfigParams>(
            params,
            MQTT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Mqtt.SetConfig', () =>
            device.sendRPC('Mqtt.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<MqttGetConfigParams>(
            params,
            MQTT_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Mqtt.GetConfig', () =>
            device.sendRPC('Mqtt.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<MqttGetStatusParams>(
            params,
            MQTT_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Mqtt.GetStatus', () =>
            device.sendRPC('Mqtt.GetStatus', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
