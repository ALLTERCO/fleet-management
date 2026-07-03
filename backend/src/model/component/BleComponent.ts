// BLE.* — device-side Bluetooth Low Energy radio + cloud relay.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BLE_CLOUDRELAY_LIST_INFOS_PARAMS_SCHEMA,
    BLE_CLOUDRELAY_LIST_PARAMS_SCHEMA,
    BLE_DELETE_PAIRED_DEVICE_PARAMS_SCHEMA,
    BLE_DESCRIBE,
    BLE_GET_CONFIG_PARAMS_SCHEMA,
    BLE_GET_STATUS_PARAMS_SCHEMA,
    BLE_LIST_PAIRED_DEVICES_PARAMS_SCHEMA,
    BLE_SET_CONFIG_PARAMS_SCHEMA,
    BLE_START_PAIRING_PARAMS_SCHEMA,
    BLE_STOP_PAIRING_PARAMS_SCHEMA,
    type BleCloudRelayListInfosParams,
    type BleCloudRelayListParams,
    type BleDeletePairedDeviceParams,
    type BleGetConfigParams,
    type BleGetStatusParams,
    type BleListPairedDevicesParams,
    type BleSetConfigParams,
    type BleStartPairingParams,
    type BleStopPairingParams
} from '../../types/api/ble';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class BleComponent extends Component<any> {
    constructor() {
        super('ble', {
            set_config_methods: false,
            auto_apply_config: false,
            // BLE.mdx → Events (since fw 2.0.0). Notification-only.
            events: [
                {
                    event: 'paired_device_added',
                    attrs: [
                        {
                            name: 'info',
                            type: 'object',
                            desc: 'Bonded device {addr, ctime, atime}'
                        }
                    ]
                },
                {
                    event: 'paired_device_removed',
                    attrs: [
                        {
                            name: 'info',
                            type: 'object',
                            desc: 'Removed bond {addr, ctime, atime}'
                        }
                    ]
                }
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BLE_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<BleSetConfigParams>(
            params,
            BLE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.SetConfig', () =>
            device.sendRPC('BLE.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<BleGetConfigParams>(
            params,
            BLE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.GetConfig', () =>
            device.sendRPC('BLE.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<BleGetStatusParams>(
            params,
            BLE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.GetStatus', () =>
            device.sendRPC('BLE.GetStatus', {})
        );
    }

    @Component.Expose('StartPairing')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async startPairing(params: unknown) {
        const v = validateOrThrow<BleStartPairingParams>(
            params,
            BLE_START_PAIRING_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.StartPairing', () =>
            device.sendRPC('BLE.StartPairing', {timeout: v.timeout})
        );
    }

    @Component.Expose('StopPairing')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async stopPairing(params: unknown) {
        const v = validateOrThrow<BleStopPairingParams>(
            params,
            BLE_STOP_PAIRING_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.StopPairing', () =>
            device.sendRPC('BLE.StopPairing', {})
        );
    }

    @Component.Expose('ListPairedDevices')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listPairedDevices(params: unknown) {
        const v = validateOrThrow<BleListPairedDevicesParams>(
            params,
            BLE_LIST_PAIRED_DEVICES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.ListPairedDevices', () =>
            device.sendRPC('BLE.ListPairedDevices', {})
        );
    }

    @Component.Expose('DeletePairedDevice')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deletePairedDevice(params: unknown) {
        const v = validateOrThrow<BleDeletePairedDeviceParams>(
            params,
            BLE_DELETE_PAIRED_DEVICE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.DeletePairedDevice', () =>
            device.sendRPC('BLE.DeletePairedDevice', {addr: v.addr})
        );
    }

    @Component.Expose('CloudRelay.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async cloudRelayList(params: unknown) {
        const v = validateOrThrow<BleCloudRelayListParams>(
            params,
            BLE_CLOUDRELAY_LIST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.CloudRelay.List', () =>
            device.sendRPC('BLE.CloudRelay.List', {})
        );
    }

    @Component.Expose('CloudRelay.ListInfos')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async cloudRelayListInfos(params: unknown) {
        const v = validateOrThrow<BleCloudRelayListInfosParams>(
            params,
            BLE_CLOUDRELAY_LIST_INFOS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BLE.CloudRelay.ListInfos', () =>
            device.sendRPC('BLE.CloudRelay.ListInfos', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
