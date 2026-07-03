import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ADDON_DESCRIBE,
    ADDON_PERIPHERAL_GET_CONFIG_PARAMS_SCHEMA,
    ADDON_PERIPHERAL_SET_CONFIG_PARAMS_SCHEMA,
    ADDON_PRO_OUTPUT_ADD_PERIPHERAL_PARAMS_SCHEMA,
    ADDON_PRO_OUTPUT_REMOVE_PERIPHERAL_PARAMS_SCHEMA,
    ADDON_SENSOR_ADD_PERIPHERAL_PARAMS_SCHEMA,
    ADDON_SENSOR_REMOVE_PERIPHERAL_PARAMS_SCHEMA,
    ADDON_SHELLY_ONLY_PARAMS_SCHEMA,
    type AddonPeripheralGetConfigParams,
    type AddonPeripheralSetConfigParams,
    type AddonProOutputAddPeripheralParams,
    type AddonProOutputRemovePeripheralParams,
    type AddonSensorAddPeripheralParams,
    type AddonSensorRemovePeripheralParams,
    type AddonShellyOnlyParams
} from '../../types/api/addon';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class AddonComponent extends Component<any> {
    constructor() {
        super('addon', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ADDON_DESCRIBE;
    }

    @Component.Expose('Sensor.GetPeripherals')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getSensorPeripherals(rawParams: unknown) {
        const {shellyID} = validateOrThrow<AddonShellyOnlyParams>(
            rawParams,
            ADDON_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.Sensor.GetPeripherals', () =>
            device.sendRPC('SensorAddon.GetPeripherals', {})
        );
    }

    @Component.Expose('Sensor.OneWireScan')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async sensorOneWireScan(rawParams: unknown) {
        const {shellyID} = validateOrThrow<AddonShellyOnlyParams>(
            rawParams,
            ADDON_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.Sensor.OneWireScan', () =>
            device.sendRPC('SensorAddon.OneWireScan', {})
        );
    }

    @Component.Expose('Sensor.AddPeripheral')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async addSensorPeripheral(rawParams: unknown) {
        const {shellyID, type, attrs} =
            validateOrThrow<AddonSensorAddPeripheralParams>(
                rawParams,
                ADDON_SENSOR_ADD_PERIPHERAL_PARAMS_SCHEMA
            );
        const payload: Record<string, unknown> = {type};
        if (attrs !== undefined) payload.attrs = attrs;
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.Sensor.AddPeripheral', () =>
            device.sendRPC('SensorAddon.AddPeripheral', payload)
        );
    }

    @Component.Expose('Sensor.RemovePeripheral')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async removeSensorPeripheral(rawParams: unknown) {
        const {shellyID, component} =
            validateOrThrow<AddonSensorRemovePeripheralParams>(
                rawParams,
                ADDON_SENSOR_REMOVE_PERIPHERAL_PARAMS_SCHEMA
            );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.Sensor.RemovePeripheral', () =>
            device.sendRPC('SensorAddon.RemovePeripheral', {component})
        );
    }

    @Component.Expose('ProOutput.GetPeripherals')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getProOutputPeripherals(rawParams: unknown) {
        const {shellyID} = validateOrThrow<AddonShellyOnlyParams>(
            rawParams,
            ADDON_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.ProOutput.GetPeripherals', () =>
            device.sendRPC('ProOutputAddon.GetPeripherals', {})
        );
    }

    @Component.Expose('ProOutput.AddPeripheral')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async addProOutputPeripheral(rawParams: unknown) {
        const {shellyID, type} =
            validateOrThrow<AddonProOutputAddPeripheralParams>(
                rawParams,
                ADDON_PRO_OUTPUT_ADD_PERIPHERAL_PARAMS_SCHEMA
            );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.ProOutput.AddPeripheral', () =>
            device.sendRPC('ProOutputAddon.AddPeripheral', {type})
        );
    }

    @Component.Expose('ProOutput.RemovePeripheral')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async removeProOutputPeripheral(rawParams: unknown) {
        const {shellyID, component} =
            validateOrThrow<AddonProOutputRemovePeripheralParams>(
                rawParams,
                ADDON_PRO_OUTPUT_REMOVE_PERIPHERAL_PARAMS_SCHEMA
            );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.ProOutput.RemovePeripheral', () =>
            device.sendRPC('ProOutputAddon.RemovePeripheral', {component})
        );
    }

    @Component.Expose('Peripheral.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getPeripheralConfig(rawParams: unknown) {
        const {shellyID, component, id} =
            validateOrThrow<AddonPeripheralGetConfigParams>(
                rawParams,
                ADDON_PERIPHERAL_GET_CONFIG_PARAMS_SCHEMA
            );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.Peripheral.GetConfig', () =>
            device.sendRPC(`${component}.GetConfig`, {id})
        );
    }

    @Component.Expose('Peripheral.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setPeripheralConfig(rawParams: unknown) {
        const {shellyID, component, id, config} =
            validateOrThrow<AddonPeripheralSetConfigParams>(
                rawParams,
                ADDON_PERIPHERAL_SET_CONFIG_PARAMS_SCHEMA
            );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Addon.Peripheral.SetConfig', () =>
            device.sendRPC(`${component}.SetConfig`, {id, config})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
