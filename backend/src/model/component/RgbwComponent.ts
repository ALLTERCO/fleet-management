import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    RGBW_DESCRIBE,
    RGBW_DIM_PARAMS_SCHEMA,
    RGBW_DIM_STOP_PARAMS_SCHEMA,
    RGBW_GET_CONFIG_PARAMS_SCHEMA,
    RGBW_GET_STATUS_PARAMS_SCHEMA,
    RGBW_SET_CONFIG_PARAMS_SCHEMA,
    RGBW_SET_PARAMS_SCHEMA,
    RGBW_TOGGLE_PARAMS_SCHEMA,
    type RgbwDimParams,
    type RgbwGetConfigParams,
    type RgbwGetStatusParams,
    type RgbwSetConfigParams,
    type RgbwSetParams,
    type RgbwToggleParams
} from '../../types/api/rgbw';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';
import {stripShellyIdFromPayload} from './colorPayload';

export default class RgbwComponent extends Component<any> {
    constructor() {
        super('rgbw', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return RGBW_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<RgbwSetParams & Record<string, unknown>>(
            params,
            RGBW_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.Set', () =>
            device.sendRPC('RGBW.Set', stripShellyIdFromPayload(v))
        );
    }

    @Component.Expose('Toggle')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async toggle(params: unknown) {
        const v = validateOrThrow<RgbwToggleParams>(
            params,
            RGBW_TOGGLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.Toggle', () =>
            device.sendRPC('RGBW.Toggle', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<RgbwSetConfigParams>(
            params,
            RGBW_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.SetConfig', () =>
            device.sendRPC('RGBW.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<RgbwGetConfigParams>(
            params,
            RGBW_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.GetConfig', () =>
            device.sendRPC('RGBW.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<RgbwGetStatusParams>(
            params,
            RGBW_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.GetStatus', () =>
            device.sendRPC('RGBW.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('DimUp')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimUp(params: unknown) {
        const v = validateOrThrow<RgbwDimParams>(
            params,
            RGBW_DIM_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.DimUp', () =>
            device.sendRPC('RGBW.DimUp', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimDown')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimDown(params: unknown) {
        const v = validateOrThrow<RgbwDimParams>(
            params,
            RGBW_DIM_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.DimDown', () =>
            device.sendRPC('RGBW.DimDown', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimStop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimStop(params: unknown) {
        const v = validateOrThrow<{shellyID: string; id: number}>(
            params,
            RGBW_DIM_STOP_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBW.DimStop', () =>
            device.sendRPC('RGBW.DimStop', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
