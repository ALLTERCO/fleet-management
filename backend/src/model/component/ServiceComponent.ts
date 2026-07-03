import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SERVICE_DESCRIBE,
    SERVICE_SET_CONFIG_PARAMS_SCHEMA,
    SERVICE_SHELLY_ID_PARAMS_SCHEMA,
    type ServiceSetConfigParams,
    type ServiceShellyIdParams
} from '../../types/api/service';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class ServiceComponent extends Component<any> {
    constructor() {
        super('service', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SERVICE_DESCRIBE;
    }

    @Component.Expose('GetInfo')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetInfo(params: unknown) {
        const v = validateOrThrow<ServiceShellyIdParams>(
            params,
            SERVICE_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Service.GetInfo', () =>
            device.sendRPC('Service.GetInfo', {id: v.id})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<ServiceShellyIdParams>(
            params,
            SERVICE_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Service.GetConfig', () =>
            device.sendRPC('Service.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<ServiceShellyIdParams>(
            params,
            SERVICE_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Service.GetStatus', () =>
            device.sendRPC('Service.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('GetResources')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetResources(params: unknown) {
        const v = validateOrThrow<ServiceShellyIdParams>(
            params,
            SERVICE_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Service.GetResources', () =>
            device.sendRPC('Service.GetResources', {id: v.id})
        );
    }

    @Component.Expose('ListConfigOptions')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcListConfigOptions(params: unknown) {
        const v = validateOrThrow<ServiceShellyIdParams>(
            params,
            SERVICE_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Service.ListConfigOptions', () =>
            device.sendRPC('Service.ListConfigOptions', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<ServiceSetConfigParams>(
            params,
            SERVICE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Service.SetConfig', () =>
            device.sendRPC('Service.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('ResetCounters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcResetCounters(params: unknown) {
        const v = validateOrThrow<ServiceShellyIdParams>(
            params,
            SERVICE_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Service.ResetCounters', () =>
            device.sendRPC('Service.ResetCounters', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
