// kind.* — list and manage device/group kinds: the vendor catalog
// (groupKindCatalog.ts) plus per-org custom kinds (organization.custom_kinds).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export type KindAppliesTo = 'device' | 'group' | 'both';

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_WRITE = {component: 'devices', operation: 'update' as const};

const APPLIES_TO_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['device', 'group', 'both']
};

// Custom slug: lowercase, starts with a letter, 2-64 chars.
const SLUG_SCHEMA: JsonSchema = {
    type: 'string',
    pattern: '^[a-z][a-z0-9_-]{1,63}$'
};

const KIND_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 128
};

// Icon must be a Font Awesome (`fa fa-`/`fas fa-`) or Material Design Icons
// (`mdi mdi-`) class. The allowlist blocks arbitrary markup in the field
// (e.g. a script tag) since the value is rendered as a CSS class on the picker.
const ICON_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    maxLength: 64,
    pattern: '^(fas? fa-|mdi mdi-)[a-z0-9-]+$'
};

const KIND_ENTRY_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['id', 'name', 'category', 'appliesTo', 'source'],
    additionalProperties: false,
    properties: {
        id: {type: 'string'},
        name: {type: 'string'},
        category: {type: 'string'},
        icon: {type: ['string', 'null']},
        appliesTo: APPLIES_TO_SCHEMA,
        source: {type: 'string', enum: ['vendor', 'custom']}
    }
};

export interface KindListParams {
    appliesTo?: KindAppliesTo;
}
export const KIND_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {appliesTo: APPLIES_TO_SCHEMA}
};

export interface KindGetParams {
    id: string;
}
export const KIND_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: KIND_ID_SCHEMA}
};

export interface KindCreateParams {
    slug: string;
    name: string;
    category: string;
    icon?: string | null;
    appliesTo: KindAppliesTo;
}
export const KIND_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['slug', 'name', 'category', 'appliesTo'],
    additionalProperties: false,
    properties: {
        slug: SLUG_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 120},
        category: {type: 'string', minLength: 1, maxLength: 40},
        icon: ICON_SCHEMA,
        appliesTo: APPLIES_TO_SCHEMA
    }
};

export interface KindUpdateParams {
    id: string;
    name: string;
    category: string;
    icon?: string | null;
    appliesTo: KindAppliesTo;
}
export const KIND_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'name', 'category', 'appliesTo'],
    additionalProperties: false,
    properties: {
        id: KIND_ID_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 120},
        category: {type: 'string', minLength: 1, maxLength: 40},
        icon: ICON_SCHEMA,
        appliesTo: APPLIES_TO_SCHEMA
    }
};

export interface KindDeleteParams {
    id: string;
}
export const KIND_DELETE_PARAMS_SCHEMA = KIND_GET_PARAMS_SCHEMA;

const b = new DescribeBuilder('kind', {
    kind: 'fleet-manager',
    description:
        'List and manage device/group kinds — vendor catalog plus per-org custom kinds.'
});

b.registerMethod('List', {
    params: KIND_LIST_PARAMS_SCHEMA,
    response: {type: 'object', description: 'kinds: array of kind entries'},
    permission: PERM_READ,
    description:
        'List kinds (vendor + this org custom), optionally filtered by appliesTo.'
});
b.registerMethod('Get', {
    params: KIND_GET_PARAMS_SCHEMA,
    response: KIND_ENTRY_RESPONSE,
    permission: PERM_READ,
    description: 'Get one kind (vendor or this org custom).'
});
b.registerMethod('Create', {
    params: KIND_CREATE_PARAMS_SCHEMA,
    response: KIND_ENTRY_RESPONSE,
    permission: PERM_WRITE,
    description: 'Create a custom kind for this org.'
});
b.registerMethod('Update', {
    params: KIND_UPDATE_PARAMS_SCHEMA,
    response: KIND_ENTRY_RESPONSE,
    permission: PERM_WRITE,
    description: 'Update a custom kind owned by this org.'
});
b.registerMethod('Delete', {
    params: KIND_DELETE_PARAMS_SCHEMA,
    response: {type: 'object', description: '{deleted: true} on success'},
    permission: PERM_WRITE,
    description:
        'Delete a custom kind; blocked while devices/groups still reference it.'
});

export const KIND_DESCRIBE: DescribeOutput = b.build();
