import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MATTER_DESCRIBE,
    MATTER_FACTORY_RESET_PARAMS_SCHEMA,
    MATTER_GET_CONFIG_PARAMS_SCHEMA,
    MATTER_GET_SETUP_CODE_PARAMS_SCHEMA,
    MATTER_GET_STATUS_PARAMS_SCHEMA,
    MATTER_SET_CONFIG_PARAMS_SCHEMA,
    type MatterFactoryResetParams,
    type MatterGetConfigParams,
    type MatterGetSetupCodeParams,
    type MatterGetStatusParams,
    type MatterSetConfigParams
} from '../../types/api/matter';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class MatterComponent extends Component<any> {
    constructor() {
        super('matter', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return MATTER_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<MatterSetConfigParams>(
            params,
            MATTER_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Matter.SetConfig', () =>
            device.sendRPC('Matter.SetConfig', {config: v.config})
        );
    }

    @Component.Expose('GetSetupCode')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getSetupCode(params: unknown) {
        const v = validateOrThrow<MatterGetSetupCodeParams>(
            params,
            MATTER_GET_SETUP_CODE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Matter.GetSetupCode', () =>
            device.sendRPC('Matter.GetSetupCode', {})
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<MatterGetConfigParams>(
            params,
            MATTER_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Matter.GetConfig', () =>
            device.sendRPC('Matter.GetConfig', {})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<MatterGetStatusParams>(
            params,
            MATTER_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Matter.GetStatus', () =>
            device.sendRPC('Matter.GetStatus', {})
        );
    }

    @Component.Expose('FactoryReset')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async factoryReset(params: unknown) {
        const v = validateOrThrow<MatterFactoryResetParams>(
            params,
            MATTER_FACTORY_RESET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Matter.FactoryReset', () =>
            device.sendRPC('Matter.FactoryReset', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
