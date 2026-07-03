import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    THERMOSTAT_CREATE_PARAMS_SCHEMA,
    THERMOSTAT_DEBUG_SET_SENSOR_TEMPERATURE_PARAMS_SCHEMA,
    THERMOSTAT_DESCRIBE,
    THERMOSTAT_SCHEDULE_CREATE_PROFILE_PARAMS_SCHEMA,
    THERMOSTAT_SCHEDULE_CREATE_RULE_PARAMS_SCHEMA,
    THERMOSTAT_SCHEDULE_DELETE_RULE_PARAMS_SCHEMA,
    THERMOSTAT_SCHEDULE_LIST_RULES_PARAMS_SCHEMA,
    THERMOSTAT_SCHEDULE_PROFILE_ID_PARAMS_SCHEMA,
    THERMOSTAT_SCHEDULE_RENAME_PROFILE_PARAMS_SCHEMA,
    THERMOSTAT_SCHEDULE_SET_CONFIG_PARAMS_SCHEMA,
    THERMOSTAT_SCHEDULE_UPDATE_RULE_PARAMS_SCHEMA,
    THERMOSTAT_SET_CONFIG_PARAMS_SCHEMA,
    THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA,
    THERMOSTAT_STEP_TARGET_PARAMS_SCHEMA,
    type ThermostatCreateParams,
    type ThermostatDebugSetSensorTemperatureParams,
    type ThermostatScheduleCreateProfileParams,
    type ThermostatScheduleCreateRuleParams,
    type ThermostatScheduleDeleteRuleParams,
    type ThermostatScheduleListRulesParams,
    type ThermostatScheduleProfileIdParams,
    type ThermostatScheduleRenameProfileParams,
    type ThermostatScheduleSetConfigParams,
    type ThermostatScheduleUpdateRuleParams,
    type ThermostatSetConfigParams,
    type ThermostatShellyIdParams,
    type ThermostatStepTargetParams
} from '../../types/api/thermostat';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class ThermostatComponent extends Component<any> {
    constructor() {
        super('thermostat', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return THERMOSTAT_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<ThermostatShellyIdParams>(
            params,
            THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.GetConfig', () =>
            device.sendRPC('Thermostat.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<ThermostatShellyIdParams>(
            params,
            THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.GetStatus', () =>
            device.sendRPC('Thermostat.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('IncreaseTargetTemperature')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async increaseTarget(params: unknown) {
        const v = validateOrThrow<ThermostatStepTargetParams>(
            params,
            THERMOSTAT_STEP_TARGET_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.delta !== undefined) payload.delta = v.delta;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.IncreaseTargetTemperature', () =>
            device.sendRPC('Thermostat.IncreaseTargetTemperature', payload)
        );
    }

    @Component.Expose('DecreaseTargetTemperature')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async decreaseTarget(params: unknown) {
        const v = validateOrThrow<ThermostatStepTargetParams>(
            params,
            THERMOSTAT_STEP_TARGET_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {id: v.id};
        if (v.delta !== undefined) payload.delta = v.delta;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.DecreaseTargetTemperature', () =>
            device.sendRPC('Thermostat.DecreaseTargetTemperature', payload)
        );
    }

    @Component.Expose('Create')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async create(params: unknown) {
        const v = validateOrThrow<ThermostatCreateParams>(
            params,
            THERMOSTAT_CREATE_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {};
        if (v.config !== undefined) payload.config = v.config;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Create', () =>
            device.sendRPC('Thermostat.Create', payload)
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async delete(params: unknown) {
        const v = validateOrThrow<ThermostatShellyIdParams>(
            params,
            THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Delete', () =>
            device.sendRPC('Thermostat.Delete', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<ThermostatSetConfigParams>(
            params,
            THERMOSTAT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.SetConfig', () =>
            device.sendRPC('Thermostat.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('Schedule.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setScheduleConfig(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleSetConfigParams>(
            params,
            THERMOSTAT_SCHEDULE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.SetConfig', () =>
            device.sendRPC('Thermostat.Schedule.SetConfig', {
                id: v.id,
                config: {enable: v.enable}
            })
        );
    }

    @Component.Expose('Schedule.ListProfiles')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listScheduleProfiles(params: unknown) {
        const v = validateOrThrow<ThermostatShellyIdParams>(
            params,
            THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.ListProfiles', () =>
            device.sendRPC('Thermostat.Schedule.ListProfiles', {id: v.id})
        );
    }

    @Component.Expose('Schedule.AddProfile')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async addScheduleProfile(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleCreateProfileParams>(
            params,
            THERMOSTAT_SCHEDULE_CREATE_PROFILE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.AddProfile', () =>
            device.sendRPC('Thermostat.Schedule.AddProfile', {
                id: v.id,
                name: v.name
            })
        );
    }

    @Component.Expose('Schedule.ListRules')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listScheduleRules(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleListRulesParams>(
            params,
            THERMOSTAT_SCHEDULE_LIST_RULES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.ListRules', () =>
            device.sendRPC('Thermostat.Schedule.ListRules', {
                id: v.id,
                profile_id: v.profile_id
            })
        );
    }

    @Component.Expose('Schedule.AddRule')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async addScheduleRule(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleCreateRuleParams>(
            params,
            THERMOSTAT_SCHEDULE_CREATE_RULE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.AddRule', () =>
            device.sendRPC('Thermostat.Schedule.AddRule', {
                id: v.id,
                profile_id: v.profile_id,
                hour: v.hour,
                minute: v.minute,
                target_C: v.target_C,
                enable: v.enable ?? true
            })
        );
    }

    @Component.Expose('Schedule.DeleteRule')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deleteScheduleRule(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleDeleteRuleParams>(
            params,
            THERMOSTAT_SCHEDULE_DELETE_RULE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.DeleteRule', () =>
            device.sendRPC('Thermostat.Schedule.DeleteRule', {
                id: v.id,
                rule_id: v.ruleId
            })
        );
    }

    @Component.Expose('Schedule.CreateProfile')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async createScheduleProfile(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleCreateProfileParams>(
            params,
            THERMOSTAT_SCHEDULE_CREATE_PROFILE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.CreateProfile', () =>
            device.sendRPC('Thermostat.Schedule.CreateProfile', {
                id: v.id,
                name: v.name
            })
        );
    }

    @Component.Expose('Schedule.RenameProfile')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async renameScheduleProfile(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleRenameProfileParams>(
            params,
            THERMOSTAT_SCHEDULE_RENAME_PROFILE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.RenameProfile', () =>
            device.sendRPC('Thermostat.Schedule.RenameProfile', {
                id: v.id,
                profile_id: v.profile_id,
                name: v.name
            })
        );
    }

    @Component.Expose('Schedule.DeleteProfile')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deleteScheduleProfile(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleProfileIdParams>(
            params,
            THERMOSTAT_SCHEDULE_PROFILE_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.DeleteProfile', () =>
            device.sendRPC('Thermostat.Schedule.DeleteProfile', {
                id: v.id,
                profile_id: v.profile_id
            })
        );
    }

    @Component.Expose('Schedule.CreateRule')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async createScheduleRule(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleCreateRuleParams>(
            params,
            THERMOSTAT_SCHEDULE_CREATE_RULE_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {
            id: v.id,
            profile_id: v.profile_id,
            hour: v.hour,
            minute: v.minute,
            target_C: v.target_C
        };
        if (v.enable !== undefined) payload.enable = v.enable;
        if (v.days !== undefined) payload.days = v.days;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.CreateRule', () =>
            device.sendRPC('Thermostat.Schedule.CreateRule', payload)
        );
    }

    @Component.Expose('Schedule.UpdateRule')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async updateScheduleRule(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleUpdateRuleParams>(
            params,
            THERMOSTAT_SCHEDULE_UPDATE_RULE_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {
            id: v.id,
            rule_id: v.rule_id
        };
        if (v.hour !== undefined) payload.hour = v.hour;
        if (v.minute !== undefined) payload.minute = v.minute;
        if (v.target_C !== undefined) payload.target_C = v.target_C;
        if (v.enable !== undefined) payload.enable = v.enable;
        if (v.days !== undefined) payload.days = v.days;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.UpdateRule', () =>
            device.sendRPC('Thermostat.Schedule.UpdateRule', payload)
        );
    }

    @Component.Expose('Schedule.ChangeRule')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async changeScheduleRule(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleUpdateRuleParams>(
            params,
            THERMOSTAT_SCHEDULE_UPDATE_RULE_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {
            id: v.id,
            rule_id: v.rule_id
        };
        if (v.hour !== undefined) payload.hour = v.hour;
        if (v.minute !== undefined) payload.minute = v.minute;
        if (v.target_C !== undefined) payload.target_C = v.target_C;
        if (v.enable !== undefined) payload.enable = v.enable;
        if (v.days !== undefined) payload.days = v.days;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.ChangeRule', () =>
            device.sendRPC('Thermostat.Schedule.ChangeRule', payload)
        );
    }

    @Component.Expose('Schedule.DeleteAllRules')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async deleteAllScheduleRules(params: unknown) {
        const v = validateOrThrow<ThermostatScheduleProfileIdParams>(
            params,
            THERMOSTAT_SCHEDULE_PROFILE_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Schedule.DeleteAllRules', () =>
            device.sendRPC('Thermostat.Schedule.DeleteAllRules', {
                id: v.id,
                profile_id: v.profile_id
            })
        );
    }

    @Component.Expose('Debug_SetSensorTemperature')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async debugSetSensorTemperature(params: unknown) {
        const v = validateOrThrow<ThermostatDebugSetSensorTemperatureParams>(
            params,
            THERMOSTAT_DEBUG_SET_SENSOR_TEMPERATURE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Thermostat.Debug_SetSensorTemperature', () =>
            device.sendRPC('Thermostat.Debug_SetSensorTemperature', {
                id: v.id,
                t_C: v.t_C
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
