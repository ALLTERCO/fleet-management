// PillUart.* — preview firmware namespace of the Pill in uart mode. Thin
// passthrough only; the firmware contract is not yet documented, so nothing
// is interpreted here.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    PILLUART_DESCRIBE,
    PILLUART_GET_CONFIG_PARAMS_SCHEMA,
    PILLUART_GET_STATUS_PARAMS_SCHEMA,
    PILLUART_SET_CONFIG_PARAMS_SCHEMA,
    type PillUartGetConfigParams,
    type PillUartGetStatusParams,
    type PillUartSetConfigParams
} from '../../types/api/pilluart';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class PillUartComponent extends Component<any> {
    constructor() {
        super('pilluart', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PILLUART_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<PillUartSetConfigParams>(
            params,
            PILLUART_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PillUart.SetConfig', () =>
            device.sendRPC('PillUart.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<PillUartGetConfigParams>(
            params,
            PILLUART_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PillUart.GetConfig', () =>
            device.sendRPC('PillUart.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<PillUartGetStatusParams>(
            params,
            PILLUART_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('PillUart.GetStatus', () =>
            device.sendRPC('PillUart.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
