// PM1.* — single-phase power meter.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    PM1_DESCRIBE,
    PM1_GET_CONFIG_PARAMS_SCHEMA,
    PM1_GET_STATUS_PARAMS_SCHEMA,
    PM1_RESET_COUNTERS_PARAMS_SCHEMA,
    PM1_SET_CONFIG_PARAMS_SCHEMA,
    type Pm1GetConfigParams,
    type Pm1GetStatusParams,
    type Pm1ResetCountersParams,
    type Pm1SetConfigParams
} from '../../types/api/pm1';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class Pm1Component extends Component<any> {
    constructor() {
        super('pm1', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PM1_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<Pm1SetConfigParams>(
            params,
            PM1_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PM1.SetConfig', () =>
            device.sendRPC('PM1.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<Pm1GetConfigParams>(
            params,
            PM1_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PM1.GetConfig', () =>
            device.sendRPC('PM1.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<Pm1GetStatusParams>(
            params,
            PM1_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PM1.GetStatus', () =>
            device.sendRPC('PM1.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('ResetCounters')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async resetCounters(params: unknown) {
        const v = validateOrThrow<Pm1ResetCountersParams>(
            params,
            PM1_RESET_COUNTERS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PM1.ResetCounters', () =>
            device.sendRPC('PM1.ResetCounters', {id: v.id, type: v.type})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
