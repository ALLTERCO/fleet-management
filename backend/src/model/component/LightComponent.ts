import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    LIGHT_CALIBRATE_PARAMS_SCHEMA,
    LIGHT_DESCRIBE,
    LIGHT_DIM_PARAMS_SCHEMA,
    LIGHT_DIM_STOP_PARAMS_SCHEMA,
    LIGHT_GET_CONFIG_PARAMS_SCHEMA,
    LIGHT_GET_STATUS_PARAMS_SCHEMA,
    LIGHT_RESET_COUNTERS_PARAMS_SCHEMA,
    LIGHT_SET_ALL_PARAMS_SCHEMA,
    LIGHT_SET_CONFIG_PARAMS_SCHEMA,
    LIGHT_SET_PARAMS_SCHEMA,
    LIGHT_TOGGLE_PARAMS_SCHEMA,
    type LightCalibrateParams,
    type LightDimParams,
    type LightGetConfigParams,
    type LightGetStatusParams,
    type LightResetCountersParams,
    type LightSetAllParams,
    type LightSetConfigParams,
    type LightSetParams,
    type LightToggleParams
} from '../../types/api/light';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

// Strip shellyID; pass everything else through (device validates ranges).
function setPayload(v: LightSetParams & Record<string, unknown>) {
    const {shellyID, ...rest} = v;
    void shellyID;
    return rest;
}

export default class LightComponent extends Component<any> {
    constructor() {
        super('light', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return LIGHT_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<LightSetParams & Record<string, unknown>>(
            params,
            LIGHT_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.Set', () =>
            device.sendRPC('Light.Set', setPayload(v))
        );
    }

    @Component.Expose('Toggle')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async toggle(params: unknown) {
        const v = validateOrThrow<LightToggleParams>(
            params,
            LIGHT_TOGGLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.Toggle', () =>
            device.sendRPC('Light.Toggle', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<LightSetConfigParams>(
            params,
            LIGHT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.SetConfig', () =>
            device.sendRPC('Light.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('Calibrate')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async calibrate(params: unknown) {
        const v = validateOrThrow<LightCalibrateParams>(
            params,
            LIGHT_CALIBRATE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.Calibrate', () =>
            device.sendRPC('Light.Calibrate', {id: v.id})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<LightGetConfigParams>(
            params,
            LIGHT_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.GetConfig', () =>
            device.sendRPC('Light.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<LightGetStatusParams>(
            params,
            LIGHT_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.GetStatus', () =>
            device.sendRPC('Light.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('DimUp')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimUp(params: unknown) {
        const v = validateOrThrow<LightDimParams>(
            params,
            LIGHT_DIM_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.DimUp', () =>
            device.sendRPC('Light.DimUp', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimDown')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimDown(params: unknown) {
        const v = validateOrThrow<LightDimParams>(
            params,
            LIGHT_DIM_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.DimDown', () =>
            device.sendRPC('Light.DimDown', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimStop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimStop(params: unknown) {
        const v = validateOrThrow<{shellyID: string; id: number}>(
            params,
            LIGHT_DIM_STOP_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.DimStop', () =>
            device.sendRPC('Light.DimStop', {id: v.id})
        );
    }

    @Component.Expose('ResetCounters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async resetCounters(params: unknown) {
        const v = validateOrThrow<LightResetCountersParams>(
            params,
            LIGHT_RESET_COUNTERS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.ResetCounters', () =>
            device.sendRPC('Light.ResetCounters', {id: v.id, types: v.types})
        );
    }

    @Component.Expose('SetAll')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setAll(params: unknown) {
        const v = validateOrThrow<LightSetAllParams>(
            params,
            LIGHT_SET_ALL_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Light.SetAll', () =>
            device.sendRPC('Light.SetAll', {
                on: v.on,
                brightness: v.brightness,
                transition_duration: v.transition_duration,
                toggle_after: v.toggle_after,
                offset: v.offset
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
