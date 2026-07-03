import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CURY_BOOST_PARAMS_SCHEMA,
    CURY_DESCRIBE,
    CURY_GET_CONFIG_PARAMS_SCHEMA,
    CURY_GET_STATUS_PARAMS_SCHEMA,
    CURY_GET_VIAL_INFO_PARAMS_SCHEMA,
    CURY_SET_AWAY_MODE_PARAMS_SCHEMA,
    CURY_SET_CONFIG_PARAMS_SCHEMA,
    CURY_SET_MODE_PARAMS_SCHEMA,
    CURY_SET_PARAMS_SCHEMA,
    CURY_STOP_BOOST_PARAMS_SCHEMA,
    type CuryBoostParams,
    type CuryGetConfigParams,
    type CuryGetStatusParams,
    type CuryGetVialInfoParams,
    type CurySetAwayModeParams,
    type CurySetConfigParams,
    type CurySetModeParams,
    type CurySetParams,
    type CuryStopBoostParams
} from '../../types/api/cury';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class CuryComponent extends Component<any> {
    constructor() {
        super('cury', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return CURY_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<CuryGetConfigParams>(
            params,
            CURY_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.GetConfig', () =>
            device.sendRPC('Cury.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<CurySetConfigParams>(
            params,
            CURY_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.SetConfig', () =>
            device.sendRPC('Cury.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<CuryGetStatusParams>(
            params,
            CURY_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.GetStatus', () =>
            device.sendRPC('Cury.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('SetMode')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setMode(params: unknown) {
        const v = validateOrThrow<CurySetModeParams>(
            params,
            CURY_SET_MODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.SetMode', () =>
            device.sendRPC('Cury.SetMode', {id: v.id, mode: v.mode ?? null})
        );
    }

    @Component.Expose('SetAwayMode')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setAwayMode(params: unknown) {
        const v = validateOrThrow<CurySetAwayModeParams>(
            params,
            CURY_SET_AWAY_MODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.SetAwayMode', () =>
            device.sendRPC('Cury.SetAwayMode', {id: v.id, on: v.on})
        );
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<CurySetParams>(
            params,
            CURY_SET_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id, slot: v.slot};
        if (v.on !== undefined) payload.on = v.on;
        if (v.intensity !== undefined) payload.intensity = v.intensity;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.Set', () =>
            device.sendRPC('Cury.Set', payload)
        );
    }

    @Component.Expose('Boost')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async boost(params: unknown) {
        const v = validateOrThrow<CuryBoostParams>(
            params,
            CURY_BOOST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.Boost', () =>
            device.sendRPC('Cury.Boost', {id: v.id, slot: v.slot})
        );
    }

    @Component.Expose('StopBoost')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async stopBoost(params: unknown) {
        const v = validateOrThrow<CuryStopBoostParams>(
            params,
            CURY_STOP_BOOST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.StopBoost', () =>
            device.sendRPC('Cury.StopBoost', {id: v.id, slot: v.slot})
        );
    }

    @Component.Expose('GetVialInfo')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getVialInfo(params: unknown) {
        const v = validateOrThrow<CuryGetVialInfoParams>(
            params,
            CURY_GET_VIAL_INFO_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.slot !== undefined) payload.slot = v.slot;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cury.GetVialInfo', () =>
            device.sendRPC('Cury.GetVialInfo', payload)
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
