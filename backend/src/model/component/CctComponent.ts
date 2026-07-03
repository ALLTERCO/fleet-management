import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CCT_DESCRIBE,
    CCT_DIM_PARAMS_SCHEMA,
    CCT_DIM_STOP_PARAMS_SCHEMA,
    CCT_GET_CONFIG_PARAMS_SCHEMA,
    CCT_GET_STATUS_PARAMS_SCHEMA,
    CCT_SET_CONFIG_PARAMS_SCHEMA,
    CCT_SET_PARAMS_SCHEMA,
    CCT_TOGGLE_PARAMS_SCHEMA,
    type CctDimParams,
    type CctGetConfigParams,
    type CctGetStatusParams,
    type CctSetConfigParams,
    type CctSetParams,
    type CctToggleParams
} from '../../types/api/cct';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

function setPayload(v: CctSetParams & Record<string, unknown>) {
    const {shellyID, ...rest} = v;
    void shellyID;
    return rest;
}

export default class CctComponent extends Component<any> {
    constructor() {
        super('cct', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return CCT_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<CctSetParams & Record<string, unknown>>(
            params,
            CCT_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.Set', () =>
            device.sendRPC('CCT.Set', setPayload(v))
        );
    }

    @Component.Expose('Toggle')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async toggle(params: unknown) {
        const v = validateOrThrow<CctToggleParams>(
            params,
            CCT_TOGGLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.Toggle', () =>
            device.sendRPC('CCT.Toggle', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<CctSetConfigParams>(
            params,
            CCT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.SetConfig', () =>
            device.sendRPC('CCT.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<CctGetConfigParams>(
            params,
            CCT_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.GetConfig', () =>
            device.sendRPC('CCT.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<CctGetStatusParams>(
            params,
            CCT_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.GetStatus', () =>
            device.sendRPC('CCT.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('DimUp')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimUp(params: unknown) {
        const v = validateOrThrow<CctDimParams>(params, CCT_DIM_PARAMS_SCHEMA);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.DimUp', () =>
            device.sendRPC('CCT.DimUp', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimDown')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimDown(params: unknown) {
        const v = validateOrThrow<CctDimParams>(params, CCT_DIM_PARAMS_SCHEMA);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.DimDown', () =>
            device.sendRPC('CCT.DimDown', {id: v.id, fade_rate: v.fade_rate})
        );
    }

    @Component.Expose('DimStop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async dimStop(params: unknown) {
        const v = validateOrThrow<{shellyID: string; id: number}>(
            params,
            CCT_DIM_STOP_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('CCT.DimStop', () =>
            device.sendRPC('CCT.DimStop', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
