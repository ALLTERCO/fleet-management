// Sys.* — device-side system (NOT the fleet-manager's System.*).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

export interface SysSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const SYS_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, config: {type: 'object'}}
};

export interface SysGetConfigParams {
    shellyID: string;
}
export const SYS_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface SysGetStatusParams {
    shellyID: string;
}
export const SYS_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// Sys.SetTime — set wall-clock time on the device.
// Per spec: `time` is "HH:MM[:SS]" local; `timezone` is IANA TZ name.
// Both optional but at least one must be provided.
export interface SysSetTimeParams {
    shellyID: string;
    time?: string;
    timezone?: string;
}
export const SYS_SET_TIME_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        time: {type: 'string'},
        timezone: {type: 'string'}
    },
    anyOf: [{required: ['time']}, {required: ['timezone']}]
};

export interface SysRestoreSettingsParams {
    shellyID: string;
    filename: string;
    etag?: string;
}
export const SYS_RESTORE_SETTINGS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'filename'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        filename: {type: 'string', minLength: 1, maxLength: 256},
        etag: {type: 'string', minLength: 1}
    }
};

export interface SysSetDebugConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const SYS_SET_DEBUG_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, config: {type: 'object'}}
};

const b = new DescribeBuilder('sys', {
    kind: 'device',
    description:
        'Read and update device-side system config, time, and diagnostics.'
});

b.registerMethod('SetConfig', {
    params: SYS_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description:
        'Sys.SetConfig — device system config (location, debug, factory_reset_from_switch, ...).'
});
b.registerMethod('GetConfig', {
    params: SYS_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Sys.GetConfig — current system configuration.'
});
b.registerMethod('GetStatus', {
    params: SYS_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Sys.GetStatus — uptime, available_updates, time, mac, restart_required.'
});
b.registerMethod('SetTime', {
    params: SYS_SET_TIME_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Sys.SetTime — set time and/or timezone (at least one required).'
});
b.registerMethod('GetInternalTemperatures', {
    params: SYS_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Sys.GetInternalTemperatures — board sensors (sht3x, thermal-cpufreq-*).'
});
b.registerMethod('ListDebugComponents', {
    params: SYS_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Sys.ListDebugComponents — debug categories that can be toggled.'
});
b.registerMethod('DownloadSettings', {
    params: SYS_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Sys.DownloadSettings — full settings backup blob.'
});
b.registerMethod('RestoreSettings', {
    params: SYS_RESTORE_SETTINGS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Sys.RestoreSettings — restore from a saved settings blob (filename required).'
});
b.registerMethod('SetDebugConfig', {
    params: SYS_SET_DEBUG_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Sys.SetDebugConfig — toggle per-component debug logging.'
});
b.registerMethod('RestartApplication', {
    params: SYS_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Sys.RestartApplication — soft-restart the firmware app (response includes restarting_after seconds).'
});

const SYS_METRICS: MetricDescriptor[] = [
    sensor('uptime', 's'),
    sensor('ram_free', 'B'),
    sensor('fs_free', 'B')
];

b.setMetrics(SYS_METRICS);

export const SYS_DESCRIBE: DescribeOutput = b.build();
