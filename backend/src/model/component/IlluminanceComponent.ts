import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ILLUMINANCE_DESCRIBE,
    ILLUMINANCE_GET_CONFIG_PARAMS_SCHEMA,
    ILLUMINANCE_GET_STATUS_PARAMS_SCHEMA,
    ILLUMINANCE_SET_CONFIG_PARAMS_SCHEMA,
    type IlluminanceGetConfigParams,
    type IlluminanceGetStatusParams,
    type IlluminanceSetConfigParams
} from '../../types/api/illuminance';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class IlluminanceComponent extends Component<any> {
    constructor() {
        super('illuminance', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ILLUMINANCE_DESCRIBE;
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<IlluminanceSetConfigParams>(
            params,
            ILLUMINANCE_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Illuminance.SetConfig', () =>
            device.sendRPC('Illuminance.SetConfig', {
                id: v.id,
                config: v.config
            })
        );
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<IlluminanceGetConfigParams>(
            params,
            ILLUMINANCE_GET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Illuminance.GetConfig', () =>
            device.sendRPC('Illuminance.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<IlluminanceGetStatusParams>(
            params,
            ILLUMINANCE_GET_STATUS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Illuminance.GetStatus', () =>
            device.sendRPC('Illuminance.GetStatus', {id: v.id})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
