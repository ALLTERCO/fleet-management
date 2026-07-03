// WS.* — device outbound WebSocket client (firmware namespace `WS`).
// Distinct from the fleet-manager's own WS ingress handlers.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    WS_DESCRIBE,
    WS_GET_CONFIG_PARAMS_SCHEMA,
    WS_GET_STATUS_PARAMS_SCHEMA,
    WS_SET_CONFIG_PARAMS_SCHEMA,
    type WsGetConfigParams,
    type WsGetStatusParams,
    type WsSetConfigParams
} from '../../types/api/ws';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class WsComponent extends Component<any> {
    constructor() {
        super('ws', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return WS_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<WsSetConfigParams>(
            params,
            WS_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('WS.SetConfig', () =>
            device.sendRPC('WS.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<WsGetConfigParams>(
            params,
            WS_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('WS.GetConfig', () =>
            device.sendRPC('WS.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<WsGetStatusParams>(
            params,
            WS_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('WS.GetStatus', () =>
            device.sendRPC('WS.GetStatus', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
