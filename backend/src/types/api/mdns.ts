import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const STATUS_RESP: JsonSchema = {
    type: 'object',
    required: ['running'],
    properties: {
        running: {type: 'boolean', description: 'mDNS responder is active.'}
    }
};

const SET_CONFIG_PARAMS: JsonSchema = {
    type: 'object',
    required: ['config'],
    additionalProperties: false,
    properties: {
        config: {
            type: 'object',
            additionalProperties: false,
            properties: {
                enable: {type: 'boolean'}
            }
        }
    }
};

const ACK: JsonSchema = {type: 'object', additionalProperties: true};

export const MDNS_DESCRIBE: DescribeOutput = new DescribeBuilder('mdns', {
    kind: 'device',
    description:
        'Relay mDNS responder status and enable/disable config to a Shelly device.'
})
    .registerMethod('GetStatus', {
        params: {type: 'object'},
        response: STATUS_RESP,
        permission: {note: 'authenticated; viewer-visible'},
        description: 'Returns whether the mDNS responder is currently running.'
    })
    .registerMethod('GetConfig', {
        params: {type: 'object'},
        response: {
            type: 'object',
            properties: {enable: {type: 'boolean'}}
        },
        permission: {note: 'authenticated; viewer-visible'},
        description: 'Returns the persisted mDNS responder configuration.'
    })
    .registerMethod('SetConfig', {
        params: SET_CONFIG_PARAMS,
        response: ACK,
        permission: {component: 'system', operation: 'update'},
        description:
            'Enable or disable the mDNS responder. Persists across restarts.'
    })
    .build();
