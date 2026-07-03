// serves.* — persisted functional relationships such as one meter measuring
// several tenants or a chiller cooling multiple floors.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const SERVES_RELATIONS = [
    'serves:serves',
    'serves:powers',
    'serves:cools',
    'serves:heats',
    'serves:measures'
] as const;

export type ServesRelation = (typeof SERVES_RELATIONS)[number];
export type ServesSourceKind = 'device' | 'group';
export type ServesTargetKind = 'device' | 'group' | 'location';

export interface ServesSourceRef {
    kind: ServesSourceKind;
    id: string;
}

export interface ServesTargetRef {
    kind: ServesTargetKind;
    id: string;
}

export interface ServesTargetInput extends ServesTargetRef {
    weight?: number | null;
}

export interface ServesLink {
    id: number;
    source: ServesSourceRef;
    target: ServesTargetRef;
    relation: ServesRelation;
    weight: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface ServesSetParams {
    source: ServesSourceRef;
    targets: ServesTargetInput[];
    relation?: ServesRelation;
}

export interface ServesUnsetParams {
    source: ServesSourceRef;
    target?: ServesTargetRef;
    relation?: ServesRelation;
}

export interface ServesListParams {
    source?: ServesSourceRef;
    target?: ServesTargetRef;
}

export interface ServesGetParams {
    source: ServesSourceRef;
    target: ServesTargetRef;
    relation?: ServesRelation;
}

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_WRITE = {component: 'devices', operation: 'update' as const};

const RELATION_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...SERVES_RELATIONS]
};

const ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 255
};

const SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind', 'id'],
    additionalProperties: false,
    properties: {
        kind: {type: 'string', enum: ['device', 'group']},
        id: ID_SCHEMA
    }
};

const TARGET_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind', 'id'],
    additionalProperties: false,
    properties: {
        kind: {type: 'string', enum: ['device', 'group', 'location']},
        id: ID_SCHEMA
    }
};

const TARGET_INPUT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind', 'id'],
    additionalProperties: false,
    properties: {
        kind: {type: 'string', enum: ['device', 'group', 'location']},
        id: ID_SCHEMA,
        weight: {type: ['number', 'null'], minimum: 1}
    }
};

const LINK_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'source',
        'target',
        'relation',
        'weight',
        'createdAt',
        'updatedAt'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'integer'},
        source: SOURCE_SCHEMA,
        target: TARGET_SCHEMA,
        relation: RELATION_SCHEMA,
        weight: {type: ['number', 'null']},
        createdAt: {type: 'string'},
        updatedAt: {type: 'string'}
    }
};

export const SERVES_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['source', 'targets'],
    additionalProperties: false,
    properties: {
        source: SOURCE_SCHEMA,
        targets: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: TARGET_INPUT_SCHEMA
        },
        relation: RELATION_SCHEMA
    }
};

export const SERVES_UNSET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['source'],
    additionalProperties: false,
    properties: {
        source: SOURCE_SCHEMA,
        target: TARGET_SCHEMA,
        relation: RELATION_SCHEMA
    }
};

export const SERVES_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        source: SOURCE_SCHEMA,
        target: TARGET_SCHEMA
    }
};

export const SERVES_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['source', 'target'],
    additionalProperties: false,
    properties: {
        source: SOURCE_SCHEMA,
        target: TARGET_SCHEMA,
        relation: RELATION_SCHEMA
    }
};

const b = new DescribeBuilder('serves', {
    kind: 'fleet-manager',
    description:
        'Manage functional relationships between devices, groups, and locations.'
});

b.registerMethod('Set', {
    params: SERVES_SET_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {items: {type: 'array', items: LINK_SCHEMA}}
    },
    permission: PERM_WRITE,
    description:
        'Create or update functional relationship links from one source to one or more targets.'
});
b.registerMethod('Unset', {
    params: SERVES_UNSET_PARAMS_SCHEMA,
    response: {type: 'object', description: '{deleted: number} on success'},
    permission: PERM_WRITE,
    description:
        'Remove one link, all links for one target, or all links for a source.'
});
b.registerMethod('List', {
    params: SERVES_LIST_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {items: {type: 'array', items: LINK_SCHEMA}}
    },
    permission: PERM_READ,
    description: 'List links by source or by target.'
});
b.registerMethod('Get', {
    params: SERVES_GET_PARAMS_SCHEMA,
    response: LINK_SCHEMA,
    permission: PERM_READ,
    description: 'Get one source-target relationship link.'
});

export const SERVES_DESCRIBE: DescribeOutput = b.build();
