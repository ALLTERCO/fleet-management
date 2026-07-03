// Wifi.* — device-side WiFi (sta + sta1 backup + ap rescue + roaming).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    WIFI_DESCRIBE,
    WIFI_GET_CONFIG_PARAMS_SCHEMA,
    WIFI_GET_STATUS_PARAMS_SCHEMA,
    WIFI_LIST_AP_CLIENTS_PARAMS_SCHEMA,
    WIFI_SAVED_NETWORKS_DELETE_PARAMS_SCHEMA,
    WIFI_SAVED_NETWORKS_LIST_PARAMS_SCHEMA,
    WIFI_SCAN_PARAMS_SCHEMA,
    WIFI_SET_CONFIG_PARAMS_SCHEMA,
    WIFI_SPEED_TEST_PARAMS_SCHEMA,
    type WifiGetConfigParams,
    type WifiGetStatusParams,
    type WifiListAPClientsParams,
    type WifiSavedNetworksDeleteParams,
    type WifiSavedNetworksListParams,
    type WifiScanParams,
    type WifiSetConfigParams,
    type WifiSpeedTestParams
} from '../../types/api/wifi';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class WifiComponent extends Component<any> {
    constructor() {
        super('wifi', {
            set_config_methods: false,
            auto_apply_config: false,
            // WiFi.mdx → Notifications. Notification-only.
            events: [
                {
                    event: 'sta_connect_fail',
                    attrs: [
                        {
                            name: 'reason',
                            type: 'number',
                            desc: 'wifi_err_reason_t'
                        }
                    ]
                },
                {
                    event: 'sta_disconnected',
                    attrs: [
                        {
                            name: 'reason',
                            type: 'number',
                            desc: 'wifi_err_reason_t'
                        },
                        {
                            name: 'ssid',
                            type: 'string',
                            desc: 'Last SSID, nullable'
                        },
                        {
                            name: 'sta_ip',
                            type: 'string',
                            desc: 'Last IP, nullable'
                        }
                    ]
                },
                {event: 'sta_connecting'},
                {
                    event: 'sta_connected',
                    attrs: [
                        {name: 'channel', type: 'number', desc: 'AP channel'},
                        {name: 'rssi', type: 'number', desc: 'Signal in dBm'}
                    ]
                },
                {
                    event: 'sta_ip_acquired',
                    attrs: [
                        {name: 'sta_ip', type: 'string', desc: 'IP acquired'},
                        {name: 'ssid', type: 'string', desc: 'AP SSID'},
                        {name: 'channel', type: 'number', desc: 'AP channel'},
                        {name: 'rssi', type: 'number', desc: 'Signal in dBm'}
                    ]
                }
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return WIFI_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<WifiSetConfigParams>(
            params,
            WIFI_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.SetConfig', () =>
            device.sendRPC('Wifi.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<WifiGetConfigParams>(
            params,
            WIFI_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.GetConfig', () =>
            device.sendRPC('Wifi.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<WifiGetStatusParams>(
            params,
            WIFI_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.GetStatus', () =>
            device.sendRPC('Wifi.GetStatus', {})
        );
    }

    @Component.Expose('Scan')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async scan(params: unknown) {
        const v = validateOrThrow<WifiScanParams>(
            params,
            WIFI_SCAN_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.Scan', () =>
            device.sendRPC('Wifi.Scan', {})
        );
    }

    @Component.Expose('ListAPClients')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listAPClients(params: unknown) {
        const v = validateOrThrow<WifiListAPClientsParams>(
            params,
            WIFI_LIST_AP_CLIENTS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.ListAPClients', () =>
            device.sendRPC('Wifi.ListAPClients', {})
        );
    }

    @Component.Expose('SavedNetworks.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async savedNetworksList(params: unknown) {
        const v = validateOrThrow<WifiSavedNetworksListParams>(
            params,
            WIFI_SAVED_NETWORKS_LIST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.SavedNetworks.List', () =>
            device.sendRPC('Wifi.SavedNetworks.List', {})
        );
    }

    @Component.Expose('SavedNetworks.Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async savedNetworksDelete(params: unknown) {
        const v = validateOrThrow<WifiSavedNetworksDeleteParams>(
            params,
            WIFI_SAVED_NETWORKS_DELETE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.SavedNetworks.Delete', () =>
            device.sendRPC('Wifi.SavedNetworks.Delete', {id: v.id})
        );
    }

    @Component.Expose('SpeedTest')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async speedTest(params: unknown) {
        const v = validateOrThrow<WifiSpeedTestParams>(
            params,
            WIFI_SPEED_TEST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Wifi.SpeedTest', () =>
            device.sendRPC('Wifi.SpeedTest', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
