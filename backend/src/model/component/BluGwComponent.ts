import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BLUGW_DESCRIBE,
    BLUGW_GET_CONFIG_PARAMS_SCHEMA,
    BLUGW_GET_STATUS_PARAMS_SCHEMA,
    BLUGW_SET_CONFIG_PARAMS_SCHEMA,
    type BluGwGetConfigParams,
    type BluGwGetStatusParams,
    type BluGwSetConfigParams
} from '../../types/api/blugw';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class BluGwComponent extends Component<any> {
    constructor() {
        super('blugw', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BLUGW_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setBluGwConfig(params: unknown) {
        const v = validateOrThrow<BluGwSetConfigParams>(
            params,
            BLUGW_SET_CONFIG_PARAMS_SCHEMA
        );
        if (Object.keys(v.config).length === 0) {
            throw RpcError.InvalidParams(
                'config must be a non-empty plain object'
            );
        }
        if (
            'sys_led_enable' in v.config &&
            typeof v.config.sys_led_enable !== 'boolean'
        ) {
            throw RpcError.InvalidParams(
                'config.sys_led_enable must be boolean'
            );
        }
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BluGw.SetConfig', () =>
            device.sendRPC('BluGw.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<BluGwGetConfigParams>(
            params,
            BLUGW_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BluGw.GetConfig', () =>
            device.sendRPC('BluGw.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<BluGwGetStatusParams>(
            params,
            BLUGW_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('BluGw.GetStatus', () =>
            device.sendRPC('BluGw.GetStatus', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
