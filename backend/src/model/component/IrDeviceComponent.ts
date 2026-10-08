// IRDevice.* — keyed irdevice:N namespace of the pre-market IR Controller
// (app IRG4). Thin passthrough only; the validated id always wins over any
// firmware-defined extras so a caller cannot retarget the call.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    IRDEVICE_DELETE_CODE_PARAMS_SCHEMA,
    IRDEVICE_DESCRIBE,
    IRDEVICE_GET_CONFIG_PARAMS_SCHEMA,
    IRDEVICE_GET_STATUS_PARAMS_SCHEMA,
    IRDEVICE_LEARN_CODE_PARAMS_SCHEMA,
    IRDEVICE_SET_CONFIG_PARAMS_SCHEMA,
    type IrDeviceDeleteCodeParams,
    type IrDeviceGetConfigParams,
    type IrDeviceGetStatusParams,
    type IrDeviceLearnCodeParams,
    type IrDeviceSetConfigParams
} from '../../types/api/irdevice';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class IrDeviceComponent extends Component<any> {
    constructor() {
        super('irdevice', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return IRDEVICE_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<IrDeviceGetConfigParams>(
            params,
            IRDEVICE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRDevice.GetConfig', () =>
            device.sendRPC('IRDevice.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<IrDeviceGetStatusParams>(
            params,
            IRDEVICE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRDevice.GetStatus', () =>
            device.sendRPC('IRDevice.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<IrDeviceSetConfigParams>(
            params,
            IRDEVICE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRDevice.SetConfig', () =>
            device.sendRPC('IRDevice.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('LearnCode')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async rpcLearnCode(params: unknown) {
        const v = validateOrThrow<IrDeviceLearnCodeParams>(
            params,
            IRDEVICE_LEARN_CODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRDevice.LearnCode', () =>
            device.sendRPC('IRDevice.LearnCode', {
                ...(v.params ?? {}),
                id: v.id
            })
        );
    }

    @Component.Expose('DeleteCode')
    @Component.CrudPermission('devices', 'delete', (p) => p?.shellyID)
    async rpcDeleteCode(params: unknown) {
        const v = validateOrThrow<IrDeviceDeleteCodeParams>(
            params,
            IRDEVICE_DELETE_CODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('IRDevice.DeleteCode', () =>
            device.sendRPC('IRDevice.DeleteCode', {
                ...(v.params ?? {}),
                id: v.id
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
