import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SECURITY_DESCRIBE,
    SECURITY_PUT_HTTP_SERVER_CA_BUNDLE_PARAMS_SCHEMA,
    SECURITY_PUT_HTTP_SERVER_CERT_PARAMS_SCHEMA,
    SECURITY_PUT_HTTP_SERVER_KEY_PARAMS_SCHEMA,
    SECURITY_PUT_TLS_CLIENT_CERT_PARAMS_SCHEMA,
    SECURITY_PUT_TLS_CLIENT_KEY_PARAMS_SCHEMA,
    SECURITY_PUT_USER_CA_PARAMS_SCHEMA,
    type SecurityPutTlsParams
} from '../../types/api/security';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

export default class SecurityComponent extends Component<any> {
    constructor() {
        super('security', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SECURITY_DESCRIBE;
    }

    @Component.Expose('PutUserCA')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putUserCA(params: unknown) {
        const v = validateOrThrow<SecurityPutTlsParams>(
            params,
            SECURITY_PUT_USER_CA_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Security.PutUserCA', () =>
            device.sendRPC('Shelly.PutUserCA', {data: v.data, append: v.append})
        );
    }

    @Component.Expose('PutTLSClientCert')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putTLSClientCert(params: unknown) {
        const v = validateOrThrow<SecurityPutTlsParams>(
            params,
            SECURITY_PUT_TLS_CLIENT_CERT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Security.PutTLSClientCert', () =>
            device.sendRPC('Shelly.PutTLSClientCert', {
                data: v.data,
                append: v.append
            })
        );
    }

    @Component.Expose('PutTLSClientKey')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putTLSClientKey(params: unknown) {
        const v = validateOrThrow<SecurityPutTlsParams>(
            params,
            SECURITY_PUT_TLS_CLIENT_KEY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Security.PutTLSClientKey', () =>
            device.sendRPC('Shelly.PutTLSClientKey', {
                data: v.data,
                append: v.append
            })
        );
    }

    @Component.Expose('PutHTTPServerCert')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putHTTPServerCert(params: unknown) {
        const v = validateOrThrow<SecurityPutTlsParams>(
            params,
            SECURITY_PUT_HTTP_SERVER_CERT_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Security.PutHTTPServerCert', () =>
            device.sendRPC('Shelly.PutHTTPServerCert', {
                data: v.data,
                append: v.append
            })
        );
    }

    @Component.Expose('PutHTTPServerKey')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putHTTPServerKey(params: unknown) {
        const v = validateOrThrow<SecurityPutTlsParams>(
            params,
            SECURITY_PUT_HTTP_SERVER_KEY_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Security.PutHTTPServerKey', () =>
            device.sendRPC('Shelly.PutHTTPServerKey', {
                data: v.data,
                append: v.append
            })
        );
    }

    @Component.Expose('PutHTTPServerCABundle')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async putHTTPServerCABundle(params: unknown) {
        const v = validateOrThrow<SecurityPutTlsParams>(
            params,
            SECURITY_PUT_HTTP_SERVER_CA_BUNDLE_PARAMS_SCHEMA
        );
        const device = getDeviceOrThrow(v.shellyID);
        return wrapDeviceRpc('Security.PutHTTPServerCABundle', () =>
            device.sendRPC('Shelly.PutHTTPServerCABundle', {
                data: v.data,
                append: v.append
            })
        );
    }

    protected override getDefaultConfig() {
        return {};
    }
}
