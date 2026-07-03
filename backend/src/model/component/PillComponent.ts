import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    PILL_DESCRIBE,
    PILL_GET_CONFIG_PARAMS_SCHEMA,
    PILL_GET_STATUS_PARAMS_SCHEMA,
    PILL_SET_CONFIG_PARAMS_SCHEMA,
    type PillGetConfigParams,
    type PillGetStatusParams,
    type PillSetConfigParams
} from '../../types/api/pill';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class PillComponent extends Component<any> {
    constructor() {
        super('pill', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PILL_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<PillSetConfigParams>(
            params,
            PILL_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Pill.SetConfig', () =>
            device.sendRPC('Pill.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<PillGetConfigParams>(
            params,
            PILL_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Pill.GetConfig', () =>
            device.sendRPC('Pill.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<PillGetStatusParams>(
            params,
            PILL_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Pill.GetStatus', () =>
            device.sendRPC('Pill.GetStatus', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
