import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    RGBCCT_DESCRIBE,
    RGBCCT_DIM_PARAMS_SCHEMA,
    RGBCCT_DIM_STOP_PARAMS_SCHEMA,
    RGBCCT_GET_CONFIG_PARAMS_SCHEMA,
    RGBCCT_GET_STATUS_PARAMS_SCHEMA,
    RGBCCT_SET_CONFIG_PARAMS_SCHEMA,
    RGBCCT_SET_PARAMS_SCHEMA,
    RGBCCT_TOGGLE_PARAMS_SCHEMA,
    type RgbcctDimParams,
    type RgbcctGetConfigParams,
    type RgbcctGetStatusParams,
    type RgbcctSetConfigParams,
    type RgbcctSetParams,
    type RgbcctToggleParams
} from '../../types/api/rgbcct';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';
import {stripShellyIdFromPayload} from './colorPayload';

export default class RgbCctComponent extends Component<any> {
    constructor() {
        super('rgbcct', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return RGBCCT_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<RgbcctSetParams & Record<string, unknown>>(
            params,
            RGBCCT_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.Set', () =>
            device.sendRPC('RGBCCT.Set', stripShellyIdFromPayload(v))
        );
    }

    @Component.Expose('Toggle')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async toggle(params: unknown) {
        const v = validateOrThrow<RgbcctToggleParams>(
            params,
            RGBCCT_TOGGLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.Toggle', () =>
            device.sendRPC('RGBCCT.Toggle', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<RgbcctSetConfigParams>(
            params,
            RGBCCT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.SetConfig', () =>
            device.sendRPC('RGBCCT.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<RgbcctGetConfigParams>(
            params,
            RGBCCT_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.GetConfig', () =>
            device.sendRPC('RGBCCT.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<RgbcctGetStatusParams>(
            params,
            RGBCCT_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.GetStatus', () =>
            device.sendRPC('RGBCCT.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('DimUp')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimUp(params: unknown) {
        const v = validateOrThrow<RgbcctDimParams>(
            params,
            RGBCCT_DIM_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.DimUp', () =>
            device.sendRPC('RGBCCT.DimUp', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimDown')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimDown(params: unknown) {
        const v = validateOrThrow<RgbcctDimParams>(
            params,
            RGBCCT_DIM_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.DimDown', () =>
            device.sendRPC('RGBCCT.DimDown', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimStop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimStop(params: unknown) {
        const v = validateOrThrow<{shellyID: string; id: number}>(
            params,
            RGBCCT_DIM_STOP_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('RGBCCT.DimStop', () =>
            device.sendRPC('RGBCCT.DimStop', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
