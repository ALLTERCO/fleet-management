// Cloud.* — device-side Shelly Cloud connection.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CLOUD_DESCRIBE,
    CLOUD_GET_CONFIG_PARAMS_SCHEMA,
    CLOUD_GET_STATUS_PARAMS_SCHEMA,
    CLOUD_SET_CONFIG_PARAMS_SCHEMA,
    type CloudGetConfigParams,
    type CloudGetStatusParams,
    type CloudSetConfigParams
} from '../../types/api/cloud';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class CloudComponent extends Component<any> {
    constructor() {
        super('cloud', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return CLOUD_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<CloudSetConfigParams>(
            params,
            CLOUD_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cloud.SetConfig', () =>
            device.sendRPC('Cloud.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<CloudGetConfigParams>(
            params,
            CLOUD_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cloud.GetConfig', () =>
            device.sendRPC('Cloud.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<CloudGetStatusParams>(
            params,
            CLOUD_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cloud.GetStatus', () =>
            device.sendRPC('Cloud.GetStatus', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
