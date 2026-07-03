import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    UI_DESCRIBE,
    UI_PLUG_SET_CONFIG_PARAMS_SCHEMA,
    UI_SCREEN_SET_PARAMS_SCHEMA,
    UI_SET_CONFIG_PARAMS_SCHEMA,
    UI_SHELLY_ONLY_PARAMS_SCHEMA,
    UI_SWIPE_PARAMS_SCHEMA,
    UI_TAP_PARAMS_SCHEMA,
    type UiPlugSetConfigParams,
    type UiScreenSetParams,
    type UiSetConfigParams,
    type UiShellyOnlyParams,
    type UiSwipeParams,
    type UiTapParams
} from '../../types/api/ui';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class UiComponent extends Component<any> {
    constructor() {
        super('ui', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return UI_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<UiShellyOnlyParams>(
            params,
            UI_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.GetConfig', () =>
            device.sendRPC('Ui.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<UiShellyOnlyParams>(
            params,
            UI_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.GetStatus', () =>
            device.sendRPC('Ui.GetStatus', {})
        );
    }

    @Component.Expose('ListAvailable')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcListAvailable(params: unknown) {
        const v = validateOrThrow<UiShellyOnlyParams>(
            params,
            UI_SHELLY_ONLY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.ListAvailable', () =>
            device.sendRPC('Ui.ListAvailable', {})
        );
    }

    @Component.Expose('Plug.SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setPlugConfig(params: unknown) {
        const v = validateOrThrow<UiPlugSetConfigParams>(
            params,
            UI_PLUG_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.Plug.SetConfig', () =>
            device.sendRPC(`${v.component}.SetConfig`, {config: v.config})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async setUiConfig(params: unknown) {
        const v = validateOrThrow<UiSetConfigParams>(
            params,
            UI_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.SetConfig', () =>
            device.sendRPC('Ui.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('Screen.Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async screenSet(params: unknown) {
        const v = validateOrThrow<UiScreenSetParams>(
            params,
            UI_SCREEN_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.Screen.Set', () =>
            device.sendRPC('Ui.Screen.Set', {on: v.on})
        );
    }

    @Component.Expose('Swipe')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async swipe(params: unknown) {
        const v = validateOrThrow<UiSwipeParams>(
            params,
            UI_SWIPE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.Swipe', () =>
            device.sendRPC('Ui.Swipe', {direction: v.direction})
        );
    }

    @Component.Expose('Tap')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async tap(params: unknown) {
        const v = validateOrThrow<UiTapParams>(params, UI_TAP_PARAMS_SCHEMA);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Ui.Tap', () => device.sendRPC('Ui.Tap', {}));
    }

    protected override getDefaultConfig() {
        return {};
    }
}
