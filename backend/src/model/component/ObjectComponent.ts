import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    OBJECT_DESCRIBE,
    OBJECT_SET_CONFIG_PARAMS_SCHEMA,
    OBJECT_SET_PARAMS_SCHEMA,
    OBJECT_SHELLY_ID_PARAMS_SCHEMA,
    type ObjectSetConfigParams,
    type ObjectSetParams,
    type ObjectShellyIdParams
} from '../../types/api/object';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class ObjectComponent extends Component<any> {
    constructor() {
        super('object', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return OBJECT_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetConfig(params: unknown) {
        const v = validateOrThrow<ObjectShellyIdParams>(
            params,
            OBJECT_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Object.GetConfig', () =>
            device.sendRPC('Object.GetConfig', {id: v.id})
        );
    }

    @Component.Expose('GetStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGetStatus(params: unknown) {
        const v = validateOrThrow<ObjectShellyIdParams>(
            params,
            OBJECT_SHELLY_ID_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Object.GetStatus', () =>
            device.sendRPC('Object.GetStatus', {id: v.id})
        );
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetConfig(params: unknown) {
        const v = validateOrThrow<ObjectSetConfigParams>(
            params,
            OBJECT_SET_CONFIG_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Object.SetConfig', () =>
            device.sendRPC('Object.SetConfig', {id: v.id, config: v.config})
        );
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async set(params: unknown) {
        const v = validateOrThrow<ObjectSetParams>(
            params,
            OBJECT_SET_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Object.Set', () =>
            device.sendRPC('Object.Set', {id: v.id, value: v.value})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
