import {DescribeBuilder, type DescribeOutput} from './_describe';
import {TLS_UPLOAD_PARAMS_SCHEMA, TLS_UPLOAD_RESPONSE_SCHEMA} from './_shared';

const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

// All Security.Put* methods share the same TLS upload envelope.
export interface SecurityPutTlsParams {
    shellyID: string;
    data: string | null;
    append: boolean;
}
export const SECURITY_PUT_USER_CA_PARAMS_SCHEMA = TLS_UPLOAD_PARAMS_SCHEMA;
export const SECURITY_PUT_TLS_CLIENT_CERT_PARAMS_SCHEMA =
    TLS_UPLOAD_PARAMS_SCHEMA;
export const SECURITY_PUT_TLS_CLIENT_KEY_PARAMS_SCHEMA =
    TLS_UPLOAD_PARAMS_SCHEMA;
export const SECURITY_PUT_HTTP_SERVER_CERT_PARAMS_SCHEMA =
    TLS_UPLOAD_PARAMS_SCHEMA;
export const SECURITY_PUT_HTTP_SERVER_KEY_PARAMS_SCHEMA =
    TLS_UPLOAD_PARAMS_SCHEMA;
export const SECURITY_PUT_HTTP_SERVER_CA_BUNDLE_PARAMS_SCHEMA =
    TLS_UPLOAD_PARAMS_SCHEMA;

export const SECURITY_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'security',
    {
        kind: 'device',
        description:
            'Upload or delete TLS certificates and keys on the target Shelly device.'
    }
)
    .registerMethod('PutUserCA', {
        params: TLS_UPLOAD_PARAMS_SCHEMA,
        response: TLS_UPLOAD_RESPONSE_SCHEMA,
        permission: PERM_UPDATE,
        description: 'Upload or delete the device user CA via Shelly.PutUserCA.'
    })
    .registerMethod('PutTLSClientCert', {
        params: TLS_UPLOAD_PARAMS_SCHEMA,
        response: TLS_UPLOAD_RESPONSE_SCHEMA,
        permission: PERM_UPDATE,
        description:
            'Upload or delete the device TLS client certificate via Shelly.PutTLSClientCert.'
    })
    .registerMethod('PutTLSClientKey', {
        params: TLS_UPLOAD_PARAMS_SCHEMA,
        response: TLS_UPLOAD_RESPONSE_SCHEMA,
        permission: PERM_UPDATE,
        description:
            'Upload or delete the device TLS client key via Shelly.PutTLSClientKey.'
    })
    .registerMethod('PutHTTPServerCert', {
        params: TLS_UPLOAD_PARAMS_SCHEMA,
        response: TLS_UPLOAD_RESPONSE_SCHEMA,
        permission: PERM_UPDATE,
        description:
            'Upload or delete the device HTTP server certificate via Shelly.PutHTTPServerCert.'
    })
    .registerMethod('PutHTTPServerKey', {
        params: TLS_UPLOAD_PARAMS_SCHEMA,
        response: TLS_UPLOAD_RESPONSE_SCHEMA,
        permission: PERM_UPDATE,
        description:
            'Upload or delete the device HTTP server private key via Shelly.PutHTTPServerKey.'
    })
    .registerMethod('PutHTTPServerCABundle', {
        params: TLS_UPLOAD_PARAMS_SCHEMA,
        response: TLS_UPLOAD_RESPONSE_SCHEMA,
        permission: PERM_UPDATE,
        description:
            'Upload or delete the device HTTP server CA bundle via Shelly.PutHTTPServerCABundle.'
    })
    .build();
