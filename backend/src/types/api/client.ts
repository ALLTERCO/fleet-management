import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const STRING_ARRAY: JsonSchema = {
    type: 'array',
    items: {type: 'string', minLength: 1, maxLength: 256},
    maxItems: 1024
};

export interface ClientSetSubscriptionParams {
    eventTypes?: string[];
    deviceIds?: string[];
}
export const CLIENT_SET_SUBSCRIPTION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        eventTypes: STRING_ARRAY,
        deviceIds: STRING_ARRAY
    }
};

const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    additionalProperties: false,
    properties: {ok: {type: 'boolean'}}
};

const b = new DescribeBuilder('client', {
    kind: 'fleet-manager',
    description:
        'Narrow the calling socket session event feed to chosen event types and devices.'
});

b.registerMethod('SetSubscription', {
    params: CLIENT_SET_SUBSCRIPTION_SCHEMA,
    response: RESP_OK,
    permission: {note: 'session-scoped — affects only the calling socket'},
    description:
        'Client.SetSubscription — narrow the current socket session feed to specific event types and/or device IDs. Empty params clear the filter.'
});

export const CLIENT_DESCRIBE: DescribeOutput = b.build();
