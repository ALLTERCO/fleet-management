import type {JsonSchema} from './_schema';

export const EMPTY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const UPLOAD_TICKET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['uploadTicket', 'expiresAt'],
    additionalProperties: false,
    properties: {
        uploadTicket: {type: 'string', minLength: 1},
        expiresAt: {type: 'string', format: 'date-time'}
    }
};

export const USERNAME_UPLOAD_TICKET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['username'],
    additionalProperties: false,
    properties: {
        username: {type: 'string', minLength: 1, maxLength: 255}
    }
};

export const LOCATION_UPLOAD_TICKET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['locationId'],
    additionalProperties: false,
    properties: {
        locationId: {type: 'integer', minimum: 1}
    }
};
