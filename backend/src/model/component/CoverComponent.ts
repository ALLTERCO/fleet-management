import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    COVER_DESCRIBE,
    COVER_GET_CONFIG_PARAMS_SCHEMA,
    COVER_GET_STATUS_PARAMS_SCHEMA,
    COVER_GO_TO_POSITION_PARAMS_SCHEMA,
    COVER_ID_PARAMS_SCHEMA,
    COVER_OPEN_CLOSE_PARAMS_SCHEMA,
    COVER_RESET_COUNTERS_PARAMS_SCHEMA,
    COVER_SET_CONFIG_PARAMS_SCHEMA,
    type CoverGetConfigParams,
    type CoverGetStatusParams,
    type CoverGoToPositionParams,
    type CoverIdParams,
    type CoverOpenCloseParams,
    type CoverResetCountersParams,
    type CoverSetConfigParams
} from '../../types/api/cover';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class CoverComponent extends Component<any> {
    constructor() {
        super('cover', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return COVER_DESCRIBE;
    }

    @Component.Expose('Open')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async open(params: unknown) {
        const v = validateOrThrow<CoverOpenCloseParams>(
            params,
            COVER_OPEN_CLOSE_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.duration !== undefined) payload.duration = v.duration;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.Open', () =>
            device.sendRPC('Cover.Open', payload)
        );
    }

    @Component.Expose('Close')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async close(params: unknown) {
        const v = validateOrThrow<CoverOpenCloseParams>(
            params,
            COVER_OPEN_CLOSE_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.duration !== undefined) payload.duration = v.duration;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.Close', () =>
            device.sendRPC('Cover.Close', payload)
        );
    }

    @Component.Expose('Stop')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async stop(params: unknown) {
        const v = validateOrThrow<CoverIdParams>(
            params,
            COVER_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.Stop', () =>
            device.sendRPC('Cover.Stop', {id: v.id})
        );
    }

    @Component.Expose('GoToPosition')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async goToPosition(params: unknown) {
        const v = validateOrThrow<CoverGoToPositionParams>(
            params,
            COVER_GO_TO_POSITION_PARAMS_SCHEMA
        );
        if (v.pos === undefined && v.slat_pos === undefined) {
            throw RpcError.InvalidParams('Expected pos and/or slat_pos');
        }
        const payload: Record<string, unknown> = {id: v.id};
        if (v.pos !== undefined) payload.pos = v.pos;
        if (v.slat_pos !== undefined) payload.slat_pos = v.slat_pos;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.GoToPosition', () =>
            device.sendRPC('Cover.GoToPosition', payload)
        );
    }

    @Component.Expose('Calibrate')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async calibrate(params: unknown) {
        const v = validateOrThrow<CoverIdParams>(
            params,
            COVER_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.Calibrate', () =>
            device.sendRPC('Cover.Calibrate', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<CoverSetConfigParams>(
            params,
            COVER_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.SetConfig', () =>
            device.sendRPC('Cover.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('ResetCounters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async resetCounters(params: unknown) {
        const v = validateOrThrow<CoverResetCountersParams>(
            params,
            COVER_RESET_COUNTERS_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.types !== undefined) payload.types = v.types;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.ResetCounters', () =>
            device.sendRPC('Cover.ResetCounters', payload)
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<CoverGetConfigParams>(
            params,
            COVER_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.GetConfig', () =>
            device.sendRPC('Cover.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<CoverGetStatusParams>(
            params,
            COVER_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Cover.GetStatus', () =>
            device.sendRPC('Cover.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
