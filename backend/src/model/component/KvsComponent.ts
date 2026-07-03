// KVS.* — device-side persistent key-value store.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    KVS_DELETE_PARAMS_SCHEMA,
    KVS_DESCRIBE,
    KVS_GET_MANY_PARAMS_SCHEMA,
    KVS_GET_PARAMS_SCHEMA,
    KVS_LIST_PARAMS_SCHEMA,
    KVS_SET_PARAMS_SCHEMA,
    type KvsDeleteParams,
    type KvsGetManyParams,
    type KvsGetParams,
    type KvsListParams,
    type KvsSetParams
} from '../../types/api/kvs';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class KvsComponent extends Component<any> {
    constructor() {
        super('kvs', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return KVS_DESCRIBE;
    }

    @Component.Expose('Get')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcGet(params: unknown) {
        const v = validateOrThrow<KvsGetParams>(params, KVS_GET_PARAMS_SCHEMA);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KVS.Get', () =>
            device.sendRPC('KVS.Get', {key: v.key})
        );
    }

    @Component.Expose('GetMany')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getMany(params: unknown) {
        const v = validateOrThrow<KvsGetManyParams>(
            params,
            KVS_GET_MANY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KVS.GetMany', () =>
            device.sendRPC('KVS.GetMany', {match: v.match, offset: v.offset})
        );
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSet(params: unknown) {
        const v = validateOrThrow<KvsSetParams>(params, KVS_SET_PARAMS_SCHEMA);
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KVS.Set', () =>
            device.sendRPC('KVS.Set', {
                key: v.key,
                value: v.value,
                etag: v.etag
            })
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcDelete(params: unknown) {
        const v = validateOrThrow<KvsDeleteParams>(
            params,
            KVS_DELETE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KVS.Delete', () =>
            device.sendRPC('KVS.Delete', {key: v.key, etag: v.etag})
        );
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async list(params: unknown) {
        const v = validateOrThrow<KvsListParams>(
            params,
            KVS_LIST_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('KVS.List', () =>
            device.sendRPC('KVS.List', {match: v.match, offset: v.offset})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
