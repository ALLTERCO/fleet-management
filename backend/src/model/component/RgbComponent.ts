import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    RGB_DESCRIBE,
    RGB_DIM_PARAMS_SCHEMA,
    RGB_DIM_STOP_PARAMS_SCHEMA,
    RGB_GET_CONFIG_PARAMS_SCHEMA,
    RGB_GET_STATUS_PARAMS_SCHEMA,
    RGB_SET_CONFIG_PARAMS_SCHEMA,
    RGB_SET_PARAMS_SCHEMA,
    RGB_TOGGLE_PARAMS_SCHEMA,
    type RgbDimParams,
    type RgbGetConfigParams,
    type RgbGetStatusParams,
    type RgbSetConfigParams,
    type RgbSetParams,
    type RgbToggleParams
} from '../../types/api/rgb';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';
import {stripShellyIdFromPayload} from './colorPayload';

export default class RgbComponent extends Component<any> {
    constructor() {
        super('rgb', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return RGB_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<RgbSetParams & Record<string, unknown>>(
            params,
            RGB_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.Set', () =>
            device.sendRPC('RGB.Set', stripShellyIdFromPayload(v))
        );
    }

    @Component.Expose('Toggle')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async toggle(params: unknown) {
        const v = validateOrThrow<RgbToggleParams>(
            params,
            RGB_TOGGLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.Toggle', () =>
            device.sendRPC('RGB.Toggle', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<RgbSetConfigParams>(
            params,
            RGB_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.SetConfig', () =>
            device.sendRPC('RGB.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<RgbGetConfigParams>(
            params,
            RGB_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.GetConfig', () =>
            device.sendRPC('RGB.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<RgbGetStatusParams>(
            params,
            RGB_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.GetStatus', () =>
            device.sendRPC('RGB.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('DimUp')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimUp(params: unknown) {
        const v = validateOrThrow<RgbDimParams>(params, RGB_DIM_PARAMS_SCHEMA);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.DimUp', () =>
            device.sendRPC('RGB.DimUp', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimDown')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimDown(params: unknown) {
        const v = validateOrThrow<RgbDimParams>(params, RGB_DIM_PARAMS_SCHEMA);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.DimDown', () =>
            device.sendRPC('RGB.DimDown', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimStop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimStop(params: unknown) {
        const v = validateOrThrow<{shellyID: string; id: number}>(
            params,
            RGB_DIM_STOP_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGB.DimStop', () =>
            device.sendRPC('RGB.DimStop', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
