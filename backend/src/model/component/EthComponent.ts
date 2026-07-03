// Eth.* — device-side wired Ethernet interface.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ETH_DESCRIBE,
    ETH_GET_CONFIG_PARAMS_SCHEMA,
    ETH_GET_STATUS_PARAMS_SCHEMA,
    ETH_LIST_CLIENTS_PARAMS_SCHEMA,
    ETH_SET_CONFIG_PARAMS_SCHEMA,
    type EthGetConfigParams,
    type EthGetStatusParams,
    type EthListClientsParams,
    type EthSetConfigParams
} from '../../types/api/eth';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class EthComponent extends Component<any> {
    constructor() {
        super('eth', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ETH_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<EthSetConfigParams>(
            params,
            ETH_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Eth.SetConfig', () =>
            device.sendRPC('Eth.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<EthGetConfigParams>(
            params,
            ETH_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Eth.GetConfig', () =>
            device.sendRPC('Eth.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<EthGetStatusParams>(
            params,
            ETH_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Eth.GetStatus', () =>
            device.sendRPC('Eth.GetStatus', {})
        );
    }

    @Component.Expose('ListClients')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listClients(params: unknown) {
        const v = validateOrThrow<EthListClientsParams>(
            params,
            ETH_LIST_CLIENTS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Eth.ListClients', () =>
            device.sendRPC('Eth.ListClients', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
