import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    DALI_DESCRIBE,
    DALI_GET_CONFIG_PARAMS_SCHEMA,
    DALI_GET_STATUS_PARAMS_SCHEMA,
    DALI_GROUP_GET_CONFIG_PARAMS_SCHEMA,
    DALI_GROUP_GET_STATUS_PARAMS_SCHEMA,
    DALI_GROUP_SET_CONFIG_PARAMS_SCHEMA,
    DALI_GROUP_SET_PARAMS_SCHEMA,
    DALI_PING_KNOWN_DEVICES_PARAMS_SCHEMA,
    DALI_SET_CONFIG_PARAMS_SCHEMA,
    DALI_START_SCAN_PARAMS_SCHEMA,
    type DaliGetConfigParams,
    type DaliGetStatusParams,
    type DaliGroupGetConfigParams,
    type DaliGroupGetStatusParams,
    type DaliGroupSetConfigParams,
    type DaliGroupSetParams,
    type DaliPingKnownDevicesParams,
    type DaliSetConfigParams,
    type DaliStartScanParams
} from '../../types/api/dali';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class DaliComponent extends Component<any> {
    constructor() {
        super('dali', {
            set_config_methods: false,
            auto_apply_config: false,
            // DALI.mdx → Notifications. Notification-only.
            events: [
                {
                    event: 'scan_complete',
                    attrs: [
                        {
                            name: 'cg_count',
                            type: 'number',
                            desc: 'Control gears found on the bus'
                        }
                    ]
                },
                {event: 'ping_complete'}
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return DALI_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(rawParams: unknown) {
        const {shellyID} = validateOrThrow<DaliGetConfigParams>(
            rawParams,
            DALI_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('DALI.GetConfig', () =>
            device.sendRPC('DALI.GetConfig', {})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(rawParams: unknown) {
        const {shellyID, config} = validateOrThrow<DaliSetConfigParams>(
            rawParams,
            DALI_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('DALI.SetConfig', () =>
            device.sendRPC('DALI.SetConfig', {config})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(rawParams: unknown) {
        const {shellyID} = validateOrThrow<DaliGetStatusParams>(
            rawParams,
            DALI_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('DALI.GetStatus', () =>
            device.sendRPC('DALI.GetStatus', {})
        );
    }

    @Component.Expose('StartScan')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async startScan(rawParams: unknown) {
        const {shellyID} = validateOrThrow<DaliStartScanParams>(
            rawParams,
            DALI_START_SCAN_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('DALI.StartScan', () =>
            device.sendRPC('DALI.StartScan', {})
        );
    }

    @Component.Expose('PingKnownDevices')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async pingKnownDevices(rawParams: unknown) {
        const {shellyID} = validateOrThrow<DaliPingKnownDevicesParams>(
            rawParams,
            DALI_PING_KNOWN_DEVICES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('DALI.PingKnownDevices', () =>
            device.sendRPC('DALI.PingKnownDevices', {})
        );
    }

    @Component.Expose('Group.GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async groupGetStatus(rawParams: unknown) {
        const {shellyID, id} = validateOrThrow<DaliGroupGetStatusParams>(
            rawParams,
            DALI_GROUP_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Dali.Group.GetStatus', () =>
            device.sendRPC('Group.GetStatus', {id})
        );
    }

    @Component.Expose('Group.GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async groupGetConfig(rawParams: unknown) {
        const {shellyID, id} = validateOrThrow<DaliGroupGetConfigParams>(
            rawParams,
            DALI_GROUP_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Dali.Group.GetConfig', () =>
            device.sendRPC('Group.GetConfig', {id})
        );
    }

    @Component.Expose('Group.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async groupSetConfig(rawParams: unknown) {
        const {shellyID, id, config} =
            validateOrThrow<DaliGroupSetConfigParams>(
                rawParams,
                DALI_GROUP_SET_CONFIG_PARAMS_SCHEMA
            );
        const device = getDeviceOrThrow(shellyID);
        return wrapDeviceRpc('Dali.Group.SetConfig', () =>
            device.sendRPC('Group.SetConfig', {id, config})
        );
    }

    @Component.Expose('Group.Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async groupSet(rawParams: unknown) {
        const {shellyID, id, on, brightness, transition} =
            validateOrThrow<DaliGroupSetParams>(
                rawParams,
                DALI_GROUP_SET_PARAMS_SCHEMA
            );
        const device = getDeviceOrThrow(shellyID);
        const payload: Record<string, unknown> = {id};
        if (on !== undefined) payload.on = on;
        if (brightness !== undefined) payload.brightness = brightness;
        if (transition !== undefined) payload.transition = transition;
        return wrapDeviceRpc('Dali.Group.Set', () =>
            device.sendRPC('Group.Set', payload)
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
