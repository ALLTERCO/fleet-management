import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

// SetConfig accepts a partial patch — any subset of fields may be sent.
// The merged result (existing config + patch) must satisfy the runtime
// invariants documented in the SetConfig description.
const WEB_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        host: {
            type: 'string',
            description: 'Bind host (default: all interfaces).'
        },
        port: {
            type: 'integer',
            description: 'HTTP listener port. Use -1 to disable HTTP.'
        },
        port_ssl: {
            type: 'integer',
            description: 'HTTPS listener port. Use -1 to disable HTTPS.'
        },
        https_crt: {
            type: 'string',
            description:
                'Path to TLS certificate. Required (non-empty) when port_ssl > -1.'
        },
        https_key: {
            type: 'string',
            description:
                'Path to TLS private key. Required (non-empty) when port_ssl > -1.'
        },
        jwt_token: {
            type: 'string',
            description: 'JWT signing secret. Must be a non-empty string.'
        }
    }
};

const SET_CONFIG_PARAMS: JsonSchema = {
    type: 'object',
    required: ['config'],
    additionalProperties: false,
    properties: {config: WEB_CONFIG_SCHEMA}
};

const ACK: JsonSchema = {type: 'object', additionalProperties: true};

export const WEB_DESCRIBE: DescribeOutput = new DescribeBuilder('web', {
    kind: 'device',
    description:
        'Relay the device web-server namespace (HTTP/HTTPS listener configuration).'
})
    .registerMethod('GetStatus', {
        params: {type: 'object'},
        response: {type: 'object', additionalProperties: true},
        permission: {note: 'authenticated'},
        description: 'Returns the listener status (currently empty).'
    })
    .registerMethod('GetConfig', {
        params: {type: 'object'},
        response: WEB_CONFIG_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'Returns the persisted HTTP/HTTPS listener configuration.'
    })
    .registerMethod('SetConfig', {
        params: SET_CONFIG_PARAMS,
        response: ACK,
        permission: {component: 'system', operation: 'update'},
        description:
            'Patch HTTP/HTTPS listener configuration. Partial: send only the keys you want to change. After merging with existing config, the result must satisfy: (1) at least one of port / port_ssl > -1, (2) https_crt + https_key non-empty when port_ssl > -1, (3) jwt_token non-empty.'
    })
    .build();
