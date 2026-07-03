// Shelly.* — device admin / identity / lifecycle methods (Gen2+).

import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SHELLY_CHECK_FOR_UPDATE_PARAMS_SCHEMA,
    SHELLY_DESCRIBE,
    SHELLY_DETECT_LOCATION_PARAMS_SCHEMA,
    SHELLY_FACTORY_RESET_PARAMS_SCHEMA,
    SHELLY_GET_COMPONENTS_PARAMS_SCHEMA,
    SHELLY_GET_CONFIG_PARAMS_SCHEMA,
    SHELLY_GET_DEVICE_INFO_PARAMS_SCHEMA,
    SHELLY_GET_STATUS_PARAMS_SCHEMA,
    SHELLY_LIST_METHODS_PARAMS_SCHEMA,
    SHELLY_LIST_PROFILES_PARAMS_SCHEMA,
    SHELLY_LIST_TIMEZONES_PARAMS_SCHEMA,
    SHELLY_REBOOT_PARAMS_SCHEMA,
    SHELLY_RESET_AUTH_CODE_PARAMS_SCHEMA,
    SHELLY_RESET_WIFI_CONFIG_PARAMS_SCHEMA,
    SHELLY_SET_AUTH_PARAMS_SCHEMA,
    SHELLY_SET_PROFILE_PARAMS_SCHEMA,
    SHELLY_UPDATE_PARAMS_SCHEMA,
    type ShellyCheckForUpdateParams,
    type ShellyDetectLocationParams,
    type ShellyFactoryResetParams,
    type ShellyGetComponentsParams,
    type ShellyGetConfigParams,
    type ShellyGetDeviceInfoParams,
    type ShellyGetStatusParams,
    type ShellyListMethodsParams,
    type ShellyListProfilesParams,
    type ShellyListTimezonesParams,
    type ShellyRebootParams,
    type ShellyResetAuthCodeParams,
    type ShellyResetWiFiConfigParams,
    type ShellySetAuthParams,
    type ShellySetProfileParams,
    type ShellyUpdateParams
} from '../../types/api/shelly';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class ShellyComponent extends Component<any> {
    constructor() {
        super('shelly', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SHELLY_DESCRIBE;
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    @Component.Expose('Reboot')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async reboot(params: unknown) {
        const v = validateOrThrow<ShellyRebootParams>(
            params,
            SHELLY_REBOOT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.Reboot', () =>
            device.sendRPC('Shelly.Reboot', {})
        );
    }

    @Component.Expose('FactoryReset')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async factoryReset(params: unknown) {
        const v = validateOrThrow<ShellyFactoryResetParams>(
            params,
            SHELLY_FACTORY_RESET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.FactoryReset', () =>
            device.sendRPC('Shelly.FactoryReset', {})
        );
    }

    @Component.Expose('CheckForUpdate')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async checkForUpdate(params: unknown) {
        const v = validateOrThrow<ShellyCheckForUpdateParams>(
            params,
            SHELLY_CHECK_FOR_UPDATE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.CheckForUpdate', () =>
            device.sendRPC('Shelly.CheckForUpdate', {})
        );
    }

    @Component.Expose('Update')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async update(params: unknown) {
        const v = validateOrThrow<ShellyUpdateParams>(
            params,
            SHELLY_UPDATE_PARAMS_SCHEMA
        );
        if (v.stage !== undefined && v.url !== undefined) {
            throw RpcError.InvalidParams(
                'Shelly.Update: pass exactly one of stage or url'
            );
        }
        const device = getDeviceOrThrow(v.shellyID);
        const payload = v.stage !== undefined ? {stage: v.stage} : {url: v.url};
        return wrapDeviceRpc('Shelly.Update', () =>
            device.sendRPC('Shelly.Update', payload)
        );
    }

    @Component.Expose('SetProfile')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setProfile(params: unknown) {
        const v = validateOrThrow<ShellySetProfileParams>(
            params,
            SHELLY_SET_PROFILE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.SetProfile', () =>
            device.sendRPC('Shelly.SetProfile', {name: v.name})
        );
    }

    @Component.Expose('ListProfiles')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listProfiles(params: unknown) {
        const v = validateOrThrow<ShellyListProfilesParams>(
            params,
            SHELLY_LIST_PROFILES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.ListProfiles', () =>
            device.sendRPC('Shelly.ListProfiles', {})
        );
    }

    // ── Identity / diagnostics ───────────────────────────────────────

    @Component.Expose('GetDeviceInfo')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getDeviceInfo(params: unknown) {
        const v = validateOrThrow<ShellyGetDeviceInfoParams>(
            params,
            SHELLY_GET_DEVICE_INFO_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.GetDeviceInfo', () =>
            device.sendRPC('Shelly.GetDeviceInfo', {ident: v.ident})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<ShellyGetStatusParams>(
            params,
            SHELLY_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.GetStatus', () =>
            device.sendRPC('Shelly.GetStatus', {})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<ShellyGetConfigParams>(
            params,
            SHELLY_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.GetConfig', () =>
            device.sendRPC('Shelly.GetConfig', {})
        );
    }

    @Component.Expose('GetComponents')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getComponents(params: unknown) {
        const v = validateOrThrow<ShellyGetComponentsParams>(
            params,
            SHELLY_GET_COMPONENTS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.GetComponents', () =>
            device.sendRPC('Shelly.GetComponents', {
                offset: v.offset,
                include: v.include,
                dynamic_only: v.dynamic_only,
                keys: v.keys
            })
        );
    }

    @Component.Expose('ListMethods')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcListMethods(params: unknown) {
        const v = validateOrThrow<ShellyListMethodsParams>(
            params,
            SHELLY_LIST_METHODS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.ListMethods', () =>
            device.sendRPC('Shelly.ListMethods', {})
        );
    }

    @Component.Expose('DetectLocation')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async detectLocation(params: unknown) {
        const v = validateOrThrow<ShellyDetectLocationParams>(
            params,
            SHELLY_DETECT_LOCATION_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.DetectLocation', () =>
            device.sendRPC('Shelly.DetectLocation', {})
        );
    }

    @Component.Expose('ListTimezones')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async listTimezones(params: unknown) {
        const v = validateOrThrow<ShellyListTimezonesParams>(
            params,
            SHELLY_LIST_TIMEZONES_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.ListTimezones', () =>
            device.sendRPC('Shelly.ListTimezones', {})
        );
    }

    @Component.Expose('ResetWiFiConfig')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async resetWiFiConfig(params: unknown) {
        const v = validateOrThrow<ShellyResetWiFiConfigParams>(
            params,
            SHELLY_RESET_WIFI_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.ResetWiFiConfig', () =>
            device.sendRPC('Shelly.ResetWiFiConfig', {})
        );
    }

    @Component.Expose('SetAuth')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setAuth(params: unknown) {
        const v = validateOrThrow<ShellySetAuthParams>(
            params,
            SHELLY_SET_AUTH_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.SetAuth', () =>
            device.sendRPC('Shelly.SetAuth', {
                user: v.user,
                realm: v.realm,
                ha1: v.ha1
            })
        );
    }

    @Component.Expose('ResetAuthCode')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async resetAuthCode(params: unknown) {
        const v = validateOrThrow<ShellyResetAuthCodeParams>(
            params,
            SHELLY_RESET_AUTH_CODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Shelly.ResetAuthCode', () =>
            device.sendRPC('Shelly.ResetAuthCode', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
