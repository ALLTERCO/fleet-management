// XMOD.* — extension module configuration via signed JWS.

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    XMOD_APPLY_PRODUCT_JWS_PARAMS_SCHEMA,
    XMOD_DESCRIBE,
    XMOD_GET_INFO_PARAMS_SCHEMA,
    XMOD_GET_PRODUCT_JWS_PARAMS_SCHEMA,
    type XmodApplyProductJwsParams,
    type XmodGetInfoParams,
    type XmodGetProductJwsParams
} from '../../types/api/xmod';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class XmodComponent extends Component<any> {
    constructor() {
        super('xmod', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return XMOD_DESCRIBE;
    }

    @Component.Expose('ApplyProductJWS')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async applyProductJWS(params: unknown) {
        const v = validateOrThrow<XmodApplyProductJwsParams>(
            params,
            XMOD_APPLY_PRODUCT_JWS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('XMOD.ApplyProductJWS', () =>
            device.sendRPC('XMOD.ApplyProductJWS', {jws: v.jws})
        );
    }

    @Component.Expose('GetProductJWS')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getProductJWS(params: unknown) {
        const v = validateOrThrow<XmodGetProductJwsParams>(
            params,
            XMOD_GET_PRODUCT_JWS_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('XMOD.GetProductJWS', () =>
            device.sendRPC('XMOD.GetProductJWS', {})
        );
    }

    @Component.Expose('GetInfo')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async getInfo(params: unknown) {
        const v = validateOrThrow<XmodGetInfoParams>(
            params,
            XMOD_GET_INFO_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('XMOD.GetInfo', () =>
            device.sendRPC('XMOD.GetInfo', {})
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
