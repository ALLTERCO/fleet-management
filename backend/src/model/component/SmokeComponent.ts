import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SMOKE_DESCRIBE,
    SMOKE_GET_CONFIG_PARAMS_SCHEMA,
    SMOKE_GET_STATUS_PARAMS_SCHEMA,
    SMOKE_MUTE_PARAMS_SCHEMA,
    SMOKE_SET_CONFIG_PARAMS_SCHEMA,
    type SmokeGetConfigParams,
    type SmokeGetStatusParams,
    type SmokeMuteParams,
    type SmokeSetConfigParams
} from '../../types/api/smoke';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class SmokeComponent extends Component<any> {
    constructor() {
        super('smoke', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SMOKE_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<SmokeSetConfigParams>(
            params,
            SMOKE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Smoke.SetConfig', () =>
            device.sendRPC('Smoke.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<SmokeGetConfigParams>(
            params,
            SMOKE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Smoke.GetConfig', () =>
            device.sendRPC('Smoke.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<SmokeGetStatusParams>(
            params,
            SMOKE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Smoke.GetStatus', () =>
            device.sendRPC('Smoke.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('Mute')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async mute(params: unknown) {
        const v = validateOrThrow<SmokeMuteParams>(
            params,
            SMOKE_MUTE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Smoke.Mute', () =>
            device.sendRPC('Smoke.Mute', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
