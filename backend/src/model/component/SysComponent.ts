// Sys.* — device-side system (not to be confused with SystemComponent,
// which serves the fleet-manager's server-side System.* API).

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SYS_DESCRIBE,
    SYS_GET_CONFIG_PARAMS_SCHEMA,
    SYS_GET_STATUS_PARAMS_SCHEMA,
    SYS_RESTORE_SETTINGS_PARAMS_SCHEMA,
    SYS_SET_CONFIG_PARAMS_SCHEMA,
    SYS_SET_DEBUG_CONFIG_PARAMS_SCHEMA,
    SYS_SET_TIME_PARAMS_SCHEMA,
    type SysGetConfigParams,
    type SysGetStatusParams,
    type SysRestoreSettingsParams,
    type SysSetConfigParams,
    type SysSetDebugConfigParams,
    type SysSetTimeParams
} from '../../types/api/sys';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class SysComponent extends Component<any> {
    constructor() {
        super('sys', {
            set_config_methods: false,
            auto_apply_config: false,
            // Sys.mdx → Notifications. All notification-only.
            events: [
                {
                    event: 'ota_begin',
                    attrs: [
                        {name: 'msg', type: 'string', desc: 'Stage message'}
                    ]
                },
                {
                    event: 'ota_progress',
                    attrs: [
                        {name: 'msg', type: 'string', desc: 'Stage message'},
                        {
                            name: 'progress_percent',
                            type: 'number',
                            desc: 'Percent complete'
                        }
                    ]
                },
                {
                    event: 'ota_success',
                    attrs: [
                        {name: 'msg', type: 'string', desc: 'Stage message'}
                    ]
                },
                {
                    event: 'ota_error',
                    attrs: [
                        {name: 'msg', type: 'string', desc: 'Stage message'}
                    ]
                },
                {event: 'sleep'},
                {
                    event: 'scheduled_restart',
                    attrs: [
                        {
                            name: 'time_ms',
                            type: 'number',
                            desc: 'ms until reboot'
                        }
                    ]
                },
                {
                    event: 'component_added',
                    attrs: [
                        {
                            name: 'target',
                            type: 'string',
                            desc: 'Component key (e.g. script:1)'
                        },
                        {
                            name: 'restart_required',
                            type: 'boolean',
                            desc: 'Device restart required to apply'
                        },
                        {
                            name: 'cfg_rev',
                            type: 'number',
                            desc: 'Config revision after add'
                        }
                    ]
                },
                {
                    event: 'component_removed',
                    attrs: [
                        {
                            name: 'target',
                            type: 'string',
                            desc: 'Component key (e.g. script:1)'
                        },
                        {
                            name: 'restart_required',
                            type: 'boolean',
                            desc: 'Device restart required to apply'
                        },
                        {
                            name: 'cfg_rev',
                            type: 'number',
                            desc: 'Config revision after remove'
                        }
                    ]
                },
                {event: 'sys_btn_down'},
                {event: 'sys_btn_up'},
                {event: 'sys_btn_push'},
                {event: 'provision_pending'},
                {event: 'provision_confirmed'},
                {event: 'provision_complete'},
                {event: 'provision_locked'}
            ]
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SYS_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<SysSetConfigParams>(
            params,
            SYS_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.SetConfig', () =>
            device.sendRPC('Sys.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<SysGetConfigParams>(
            params,
            SYS_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.GetConfig', () =>
            device.sendRPC('Sys.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<SysGetStatusParams>(
            params,
            SYS_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.GetStatus', () =>
            device.sendRPC('Sys.GetStatus', {})
        );
    }

    @Component.Expose('SetTime')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setTime(params: unknown) {
        const v = validateOrThrow<SysSetTimeParams>(
            params,
            SYS_SET_TIME_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.SetTime', () =>
            device.sendRPC('Sys.SetTime', {
                time: v.time,
                timezone: v.timezone
            })
        );
    }

    @Component.Expose('GetInternalTemperatures')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getInternalTemperatures(params: unknown) {
        const v = validateOrThrow<SysGetStatusParams>(
            params,
            SYS_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.GetInternalTemperatures', () =>
            device.sendRPC('Sys.GetInternalTemperatures', {})
        );
    }

    @Component.Expose('ListDebugComponents')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listDebugComponents(params: unknown) {
        const v = validateOrThrow<SysGetStatusParams>(
            params,
            SYS_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.ListDebugComponents', () =>
            device.sendRPC('Sys.ListDebugComponents', {})
        );
    }

    @Component.Expose('DownloadSettings')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async downloadSettings(params: unknown) {
        const v = validateOrThrow<SysGetStatusParams>(
            params,
            SYS_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.DownloadSettings', () =>
            device.sendRPC('Sys.DownloadSettings', {})
        );
    }

    @Component.Expose('RestoreSettings')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async restoreSettings(params: unknown) {
        const v = validateOrThrow<SysRestoreSettingsParams>(
            params,
            SYS_RESTORE_SETTINGS_PARAMS_SCHEMA
        );
        const payload: Record<string, unknown> = {filename: v.filename};
        if (v.etag !== undefined) payload.etag = v.etag;
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.RestoreSettings', () =>
            device.sendRPC('Sys.RestoreSettings', payload)
        );
    }

    @Component.Expose('SetDebugConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setDebugConfig(params: unknown) {
        const v = validateOrThrow<SysSetDebugConfigParams>(
            params,
            SYS_SET_DEBUG_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.SetDebugConfig', () =>
            device.sendRPC('Sys.SetDebugConfig', {config: v.config})
        );
    }

    @Component.Expose('RestartApplication')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async restartApplication(params: unknown) {
        const v = validateOrThrow<SysGetStatusParams>(
            params,
            SYS_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Sys.RestartApplication', () =>
            device.sendRPC('Sys.RestartApplication', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
