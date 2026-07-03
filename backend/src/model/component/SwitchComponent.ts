import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SWITCH_DESCRIBE,
    SWITCH_GET_CONFIG_PARAMS_SCHEMA,
    SWITCH_GET_STATUS_PARAMS_SCHEMA,
    SWITCH_RESET_COUNTERS_PARAMS_SCHEMA,
    SWITCH_SET_CONFIG_PARAMS_SCHEMA,
    SWITCH_SET_PARAMS_SCHEMA,
    SWITCH_TOGGLE_PARAMS_SCHEMA,
    type SwitchGetConfigParams,
    type SwitchGetStatusParams,
    type SwitchResetCountersParams,
    type SwitchSetConfigParams,
    type SwitchSetParams,
    type SwitchToggleParams
} from '../../types/api/switch';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class SwitchComponent extends Component<any> {
    constructor() {
        super('switch', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SWITCH_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<SwitchSetParams>(
            params,
            SWITCH_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const payload: Record<string, unknown> = {id: v.id, on: v.on};
        if (v.toggle_after !== undefined) payload.toggle_after = v.toggle_after;
        return wrapDeviceRpc('Switch.Set', () =>
            device.sendRPC('Switch.Set', payload)
        );
    }

    @Component.Expose('Toggle')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async toggle(params: unknown) {
        const v = validateOrThrow<SwitchToggleParams>(
            params,
            SWITCH_TOGGLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Switch.Toggle', () =>
            device.sendRPC('Switch.Toggle', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<SwitchSetConfigParams>(
            params,
            SWITCH_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Switch.SetConfig', () =>
            device.sendRPC('Switch.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('ResetCounters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async resetCounters(params: unknown) {
        const v = validateOrThrow<SwitchResetCountersParams>(
            params,
            SWITCH_RESET_COUNTERS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        const payload: Record<string, unknown> = {id: v.id};
        if (v.types !== undefined) payload.types = v.types;
        return wrapDeviceRpc('Switch.ResetCounters', () =>
            device.sendRPC('Switch.ResetCounters', payload)
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<SwitchGetConfigParams>(
            params,
            SWITCH_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Switch.GetConfig', () =>
            device.sendRPC('Switch.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<SwitchGetStatusParams>(
            params,
            SWITCH_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Switch.GetStatus', () =>
            device.sendRPC('Switch.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
