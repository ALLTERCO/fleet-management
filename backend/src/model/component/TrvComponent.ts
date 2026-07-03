import {composeTrvTimespec as composeTrvTimespecPure} from '../../rpc/cron';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    TRV_CALL_PARAMS_SCHEMA,
    TRV_DESCRIBE,
    TRV_FLAG_PARAMS_SCHEMA,
    TRV_GET_CONFIG_PARAMS_SCHEMA,
    TRV_GET_REMOTE_DEVICE_INFO_PARAMS_SCHEMA,
    TRV_GET_STATUS_PARAMS_SCHEMA,
    TRV_PAIRING_COMPLETE_PARAMS_SCHEMA,
    TRV_SCHEDULE_ADD_PARAMS_SCHEMA,
    TRV_SCHEDULE_LIST_PARAMS_SCHEMA,
    TRV_SCHEDULE_REMOVE_PARAMS_SCHEMA,
    TRV_SCHEDULE_UPDATE_PARAMS_SCHEMA,
    TRV_SET_BOOST_PARAMS_SCHEMA,
    TRV_SET_CONFIG_PARAMS_SCHEMA,
    TRV_SET_EXTERNAL_TEMPERATURE_PARAMS_SCHEMA,
    TRV_SET_OVERRIDE_PARAMS_SCHEMA,
    TRV_SET_POSITION_PARAMS_SCHEMA,
    TRV_SET_TARGET_PARAMS_SCHEMA,
    TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA,
    TRV_SHOW_MESSAGE_PARAMS_SCHEMA,
    TRV_UPDATE_FIRMWARE_PARAMS_SCHEMA,
    type TrvCallParams,
    type TrvFlagParams,
    type TrvPairingCompleteParams,
    type TrvScheduleAddParams,
    type TrvScheduleListParams,
    type TrvScheduleRemoveParams,
    type TrvScheduleUpdateParams,
    type TrvSetBoostParams,
    type TrvSetConfigParams,
    type TrvSetExternalTemperatureParams,
    type TrvSetOverrideParams,
    type TrvSetPositionParams,
    type TrvSetTargetParams,
    type TrvShellyIdParams,
    type TrvShellyIdWithThermostatParams,
    type TrvShowMessageParams,
    type TrvUpdateFirmwareParams
} from '../../types/api/trv';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

function normalizeThermostatId(thermostatId: number | undefined): number {
    if (thermostatId === undefined) return 0;
    if (!Number.isInteger(thermostatId) || thermostatId < 0) {
        throw RpcError.InvalidParams(
            'thermostatId must be a non-negative integer (default 0)'
        );
    }
    return thermostatId;
}

function composeTrvTimespec(
    hour: number,
    minute: number,
    days?: number[]
): string {
    try {
        return composeTrvTimespecPure(hour, minute, days);
    } catch (err: unknown) {
        throw RpcError.InvalidParams(
            err instanceof Error ? err.message : String(err)
        );
    }
}

async function bluTrvPassthroughById(
    label: string,
    shellyMethod: string,
    v: TrvShellyIdParams
) {
    const device = getDeviceOrThrow(v.shellyID);
    return wrapDeviceRpc(label, () => device.sendRPC(shellyMethod, {id: v.id}));
}

export default class TrvComponent extends Component<any> {
    constructor() {
        super('trv', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return TRV_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<TrvShellyIdParams>(
            params,
            TRV_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.GetConfig', () =>
            device.sendRPC('BluTrv.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<TrvShellyIdParams>(
            params,
            TRV_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.GetStatus', () =>
            device.sendRPC('BluTrv.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('GetRemoteConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getRemoteConfig(params: unknown) {
        const v = validateOrThrow<TrvShellyIdParams>(
            params,
            TRV_GET_CONFIG_PARAMS_SCHEMA
        );
        return bluTrvPassthroughById(
            'Trv.GetRemoteConfig',
            'BluTrv.GetRemoteConfig',
            v
        );
    }

    @Component.Expose('GetRemoteStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getRemoteStatus(params: unknown) {
        const v = validateOrThrow<TrvShellyIdParams>(
            params,
            TRV_GET_STATUS_PARAMS_SCHEMA
        );
        return bluTrvPassthroughById(
            'Trv.GetRemoteStatus',
            'BluTrv.GetRemoteStatus',
            v
        );
    }

    @Component.Expose('GetRemoteDeviceInfo')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getRemoteDeviceInfo(params: unknown) {
        const v = validateOrThrow<TrvShellyIdParams>(
            params,
            TRV_GET_REMOTE_DEVICE_INFO_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.GetRemoteDeviceInfo', () =>
            device.sendRPC('BluTrv.GetRemoteDeviceInfo', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setTrvConfig(params: unknown) {
        const v = validateOrThrow<TrvSetConfigParams>(
            params,
            TRV_SET_CONFIG_PARAMS_SCHEMA
        );
        if (Object.keys(v.config).length === 0) {
            throw RpcError.InvalidParams(
                'config must be a non-empty plain object'
            );
        }
        if ('name' in v.config) {
            const n = v.config.name;
            if (n !== null && (typeof n !== 'string' || n.length === 0)) {
                throw RpcError.InvalidParams(
                    'config.name must be a non-empty string or null to clear'
                );
            }
        }
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.SetConfig', () =>
            device.sendRPC('BluTrv.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('CheckForUpdates')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async checkForUpdates(params: unknown) {
        const v = validateOrThrow<TrvShellyIdParams>(
            params,
            TRV_GET_CONFIG_PARAMS_SCHEMA
        );
        return bluTrvPassthroughById(
            'Trv.CheckForUpdates',
            'BluTrv.CheckForUpdates',
            v
        );
    }

    @Component.Expose('UpdateFirmware')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async updateFirmware(params: unknown) {
        const v = validateOrThrow<TrvUpdateFirmwareParams>(
            params,
            TRV_UPDATE_FIRMWARE_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.bootloader !== undefined) payload.bootloader = v.bootloader;
        if (v.url !== undefined) payload.url = v.url;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.UpdateFirmware', () =>
            device.sendRPC('BluTrv.UpdateFirmware', payload)
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'delete', (p) => p?.shellyID)
    async delete(params: unknown) {
        const v = validateOrThrow<TrvShellyIdParams>(
            params,
            TRV_GET_CONFIG_PARAMS_SCHEMA
        );
        return bluTrvPassthroughById('Trv.Delete', 'BluTrv.Delete', v);
    }

    @Component.Expose('Call')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async callTrv(params: unknown) {
        const v = validateOrThrow<TrvCallParams>(
            params,
            TRV_CALL_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.Call', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: v.method,
                params: v.params ?? {}
            })
        );
    }

    @Component.Expose('GetRemoteTrvConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getRemoteTrvConfig(params: unknown) {
        const v = validateOrThrow<TrvShellyIdWithThermostatParams>(
            params,
            TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.GetRemoteTrvConfig', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.GetConfig',
                params: {id: tId}
            })
        );
    }

    @Component.Expose('GetRemoteTrvStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getRemoteTrvStatus(params: unknown) {
        const v = validateOrThrow<TrvShellyIdWithThermostatParams>(
            params,
            TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.GetRemoteTrvStatus', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.GetStatus',
                params: {id: tId}
            })
        );
    }

    @Component.Expose('SetTarget')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setTarget(params: unknown) {
        const v = validateOrThrow<TrvSetTargetParams>(
            params,
            TRV_SET_TARGET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.SetTarget', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.SetTarget',
                params: {id: tId, target_C: v.target_C}
            })
        );
    }

    @Component.Expose('Calibrate')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async calibrate(params: unknown) {
        const v = validateOrThrow<TrvShellyIdWithThermostatParams>(
            params,
            TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.Calibrate', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.Calibrate',
                params: {id: tId}
            })
        );
    }

    @Component.Expose('SetBoost')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setBoost(params: unknown) {
        const v = validateOrThrow<TrvSetBoostParams>(
            params,
            TRV_SET_BOOST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        const inner: Record<string, unknown> = {id: tId};
        if (v.duration !== undefined) inner.duration = v.duration;
        return wrapDeviceRpc('Trv.SetBoost', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.SetBoost',
                params: inner
            })
        );
    }

    @Component.Expose('ClearBoost')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async clearBoost(params: unknown) {
        const v = validateOrThrow<TrvShellyIdWithThermostatParams>(
            params,
            TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.ClearBoost', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.ClearBoost',
                params: {id: tId}
            })
        );
    }

    @Component.Expose('SetOverride')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setOverride(params: unknown) {
        const v = validateOrThrow<TrvSetOverrideParams>(
            params,
            TRV_SET_OVERRIDE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.SetOverride', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.SetOverride',
                params: {id: tId, target_C: v.target_C, duration: v.duration}
            })
        );
    }

    @Component.Expose('ClearOverride')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async clearOverride(params: unknown) {
        const v = validateOrThrow<TrvShellyIdWithThermostatParams>(
            params,
            TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.ClearOverride', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.ClearOverride',
                params: {id: tId}
            })
        );
    }

    @Component.Expose('SetExternalTemperature')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setExternalTemperature(params: unknown) {
        const v = validateOrThrow<TrvSetExternalTemperatureParams>(
            params,
            TRV_SET_EXTERNAL_TEMPERATURE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        const inner: Record<string, unknown> = {id: tId};
        if (v.t_C !== undefined) inner.t_C = v.t_C;
        return wrapDeviceRpc('Trv.SetExternalTemperature', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.SetExternalTemperature',
                params: inner
            })
        );
    }

    @Component.Expose('SetPosition')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setPosition(params: unknown) {
        const v = validateOrThrow<TrvSetPositionParams>(
            params,
            TRV_SET_POSITION_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.SetPosition', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.SetPosition',
                params: {id: tId, pos: v.pos}
            })
        );
    }

    @Component.Expose('SetFlag')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async setFlag(params: unknown) {
        const v = validateOrThrow<TrvFlagParams>(
            params,
            TRV_FLAG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.SetFlag', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.SetFlag',
                params: {id: tId, flag: v.flag}
            })
        );
    }

    @Component.Expose('ClearFlag')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async clearFlag(params: unknown) {
        const v = validateOrThrow<TrvFlagParams>(
            params,
            TRV_FLAG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.ClearFlag', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.ClearFlag',
                params: {id: tId, flag: v.flag}
            })
        );
    }

    @Component.Expose('ShowMessage')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async showMessage(params: unknown) {
        const v = validateOrThrow<TrvShowMessageParams>(
            params,
            TRV_SHOW_MESSAGE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.ShowMessage', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.ShowMessage',
                params: {id: tId, message: v.message}
            })
        );
    }

    @Component.Expose('PairingComplete')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async pairingComplete(params: unknown) {
        const v = validateOrThrow<TrvPairingCompleteParams>(
            params,
            TRV_PAIRING_COMPLETE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const tId = normalizeThermostatId(v.thermostatId);
        return wrapDeviceRpc('Trv.PairingComplete', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.PairingComplete',
                params: {id: tId, success: v.success}
            })
        );
    }

    @Component.Expose('Schedule.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listSchedule(params: unknown) {
        const v = validateOrThrow<TrvScheduleListParams>(
            params,
            TRV_SCHEDULE_LIST_PARAMS_SCHEMA
        );
        const tId = normalizeThermostatId(v.thermostatId);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.Schedule.List', async () => {
            const result = await device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.ListScheduleRules',
                params: {id: tId}
            });
            return {rules: result?.rules ?? []};
        });
    }

    @Component.Expose('Schedule.Add')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async addSchedule(params: unknown) {
        const v = validateOrThrow<TrvScheduleAddParams>(
            params,
            TRV_SCHEDULE_ADD_PARAMS_SCHEMA
        );
        const tId = normalizeThermostatId(v.thermostatId);
        const timespec = composeTrvTimespec(v.hour, v.minute, v.days);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.Schedule.Add', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.AddScheduleRule',
                params: {
                    id: tId,
                    rule: {
                        enable: v.enable ?? true,
                        timespec,
                        target_C: v.target_C
                    }
                }
            })
        );
    }

    @Component.Expose('Schedule.Update')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async updateSchedule(params: unknown) {
        const v = validateOrThrow<TrvScheduleUpdateParams>(
            params,
            TRV_SCHEDULE_UPDATE_PARAMS_SCHEMA
        );
        const tId = normalizeThermostatId(v.thermostatId);
        const rule: Record<string, any> = {};
        if (typeof v.enable === 'boolean') rule.enable = v.enable;
        if (typeof v.target_C === 'number') rule.target_C = v.target_C;
        if (typeof v.hour === 'number' || typeof v.minute === 'number') {
            if (typeof v.hour !== 'number' || typeof v.minute !== 'number') {
                throw RpcError.InvalidParams(
                    'hour and minute must be provided together when updating time'
                );
            }
            rule.timespec = composeTrvTimespec(v.hour, v.minute, v.days);
        }
        if (Object.keys(rule).length === 0) {
            throw RpcError.InvalidParams(
                'Nothing to update; provide at least one of enable, target_C, or hour+minute'
            );
        }
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.Schedule.Update', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.UpdateScheduleRule',
                params: {id: tId, rule_id: v.ruleId, rule}
            })
        );
    }

    @Component.Expose('Schedule.Remove')
    @Component.CrudPermission('devices', 'delete', (p) => p?.shellyID)
    async removeSchedule(params: unknown) {
        const v = validateOrThrow<TrvScheduleRemoveParams>(
            params,
            TRV_SCHEDULE_REMOVE_PARAMS_SCHEMA
        );
        const tId = normalizeThermostatId(v.thermostatId);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Trv.Schedule.Remove', () =>
            device.sendRPC('BluTrv.Call', {
                id: v.id,
                method: 'Trv.RemoveScheduleRule',
                params: {id: tId, rule_id: v.ruleId}
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
