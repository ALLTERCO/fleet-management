// Device-side KNX integration (Pro line). 4 wrappers: global SetConfig +
// per-component KNX bindings (KNXSwitch/Light/Cover/Input).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    KNX_COMPONENT_KEY_PARAMS_SCHEMA,
    KNX_DESCRIBE,
    KNX_GET_CONFIG_PARAMS_SCHEMA,
    KNX_GET_STATUS_PARAMS_SCHEMA,
    KNX_LIST_COMPONENTS_PARAMS_SCHEMA,
    KNX_SET_COMPONENT_CONFIG_PARAMS_SCHEMA,
    KNX_SET_CONFIG_PARAMS_SCHEMA,
    type KnxComponentKeyParams,
    type KnxGetConfigParams,
    type KnxGetStatusParams,
    type KnxListComponentsParams,
    type KnxSetComponentConfigParams,
    type KnxSetConfigParams
} from '../../types/api/knx';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class KnxComponent extends Component<any> {
    constructor() {
        super('knx', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return KNX_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<KnxSetConfigParams>(
            params,
            KNX_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KNX.SetConfig', () =>
            device.sendRPC('KNX.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<KnxGetConfigParams>(
            params,
            KNX_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KNX.GetConfig', () =>
            device.sendRPC('KNX.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<KnxGetStatusParams>(
            params,
            KNX_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KNX.GetStatus', () =>
            device.sendRPC('KNX.GetStatus', {})
        );
    }

    @Component.Expose('GetComponentConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getComponentConfig(params: unknown) {
        const v = validateOrThrow<KnxComponentKeyParams>(
            params,
            KNX_COMPONENT_KEY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KNX.GetComponentConfig', () =>
            device.sendRPC('KNX.GetComponentConfig', {key: v.key})
        );
    }

    @Component.Expose('SetComponentConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setComponentConfig(params: unknown) {
        const v = validateOrThrow<KnxSetComponentConfigParams>(
            params,
            KNX_SET_COMPONENT_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KNX.SetComponentConfig', () =>
            device.sendRPC('KNX.SetComponentConfig', {
                key: v.key,
                config: v.config
            })
        );
    }

    @Component.Expose('ListComponents')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listComponents(params: unknown) {
        const v = validateOrThrow<KnxListComponentsParams>(
            params,
            KNX_LIST_COMPONENTS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KNX.ListComponents', () =>
            device.sendRPC('KNX.ListComponents', {offset: v.offset})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
