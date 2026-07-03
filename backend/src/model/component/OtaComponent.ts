import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    OTA_DATA_PARAMS_SCHEMA,
    OTA_DESCRIBE,
    OTA_SHELLY_ONLY_PARAMS_SCHEMA,
    OTA_START_PARAMS_SCHEMA,
    OTA_UPDATE_PARAMS_SCHEMA,
    OTA_WRITE_PARAMS_SCHEMA,
    type OtaDataParams,
    type OtaShellyOnlyParams,
    type OtaStartParams,
    type OtaUpdateParams,
    type OtaWriteParams
} from '../../types/api/ota';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class OtaComponent extends Component<any> {
    constructor() {
        super('ota', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return OTA_DESCRIBE;
    }

    @Component.Expose('Update')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async update(params: unknown) {
        const v = validateOrThrow<OtaUpdateParams>(
            params,
            OTA_UPDATE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        // The device performs the fetch and the caller holds devices:execute,
        // so FM does not gate the host — relay the url as-is.
        return wrapDeviceRpc('OTA.Update', () =>
            device.sendRPC('OTA.Update', {url: v.url})
        );
    }

    @Component.Expose('Start')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async start(params: unknown) {
        const v = validateOrThrow<OtaStartParams>(
            params,
            OTA_START_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('OTA.Start', () =>
            device.sendRPC('OTA.Start', {size: v.size})
        );
    }

    @Component.Expose('Write')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async write(params: unknown) {
        const v = validateOrThrow<OtaWriteParams>(
            params,
            OTA_WRITE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('OTA.Write', () =>
            device.sendRPC('OTA.Write', {offset: v.offset, data: v.data})
        );
    }

    @Component.Expose('Data')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async data(params: unknown) {
        const v = validateOrThrow<OtaDataParams>(
            params,
            OTA_DATA_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('OTA.Data', () =>
            device.sendRPC('OTA.Data', {data: v.data})
        );
    }

    @Component.Expose('Commit')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async commit(params: unknown) {
        const v = validateOrThrow<OtaShellyOnlyParams>(
            params,
            OTA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('OTA.Commit', () =>
            device.sendRPC('OTA.Commit', {})
        );
    }

    @Component.Expose('Abort')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async abort(params: unknown) {
        const v = validateOrThrow<OtaShellyOnlyParams>(
            params,
            OTA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('OTA.Abort', () =>
            device.sendRPC('OTA.Abort', {})
        );
    }

    @Component.Expose('Revert')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async revert(params: unknown) {
        const v = validateOrThrow<OtaShellyOnlyParams>(
            params,
            OTA_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('OTA.Revert', () =>
            device.sendRPC('OTA.Revert', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
