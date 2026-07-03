/** Public API types for the `tag.*` namespace — label/category layer. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    MAX_BATCH_SIZE,
    METADATA_SCHEMA,
    NAME_SCHEMA,
    ORG_ID_SCHEMA
} from './_shared';

// Sync with CHECK in 2004_tags.sql (tag_assignment_subject_valid).
export const TAG_SUBJECT_TYPES = [
    'location',
    'group',
    'device',
    'entity',
    'alert_rule',
    'destination_group',
    'channel',
    'script'
] as const;
export type TagSubjectType = (typeof TAG_SUBJECT_TYPES)[number];

export interface Tag {
    id: number;
    organizationId: string;
    key: string;
    name: string;
    description: string | null;
    color: string | null;
    icon: string | null;
    metadata: Record<string, unknown>;
    imageAssetId: string | null;
    createdAt: string;
    updatedAt: string | null;
    counts?: Record<string, number>;
}

// Spec tag_assignment_ref_t — tagId lives in the envelope, not per row.
export interface TagAssignmentRef {
    subjectType: TagSubjectType;
    subjectId: string;
}

// Spec §7.4 — tags_key_pattern CHECK is identical in SQL.
const KEY_SCHEMA: JsonSchema = {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9._-]{1,63}$'
};
const DESCRIPTION_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    maxLength: 500
};
const COLOR_SCHEMA: JsonSchema = {
    // Accent token key (e.g. 'switch') or legacy #RRGGBB hex.
    type: ['string', 'null'],
    pattern: '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_-]{0,63})$'
};
// Accepts legacy FA-name slugs ('gear'), full FA classes ('fas fa-gear'),
// and MDI classes ('mdi mdi-fridge'). Renderer detects the space-delimited
// full-class form and uses it verbatim; otherwise it prefixes 'fas fa-'.
// Pattern rejects whitespace-only / punctuation-only values that would
// render as broken CSS classes.
const ICON_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    minLength: 1,
    maxLength: 80,
    pattern: '^[A-Za-z0-9][A-Za-z0-9 ._-]*$'
};
// Optional picture for a tag — a UUID into the shared image-asset store, the
// same reference devices and groups use. Null clears it.
const IMAGE_ASSET_ID_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    format: 'uuid'
};
const SUBJECT_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...TAG_SUBJECT_TYPES]
};
const SUBJECT_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 255
};
const SUBJECT_REF_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['subjectType', 'subjectId'],
    additionalProperties: false,
    properties: {
        subjectType: SUBJECT_TYPE_SCHEMA,
        subjectId: SUBJECT_ID_SCHEMA
    }
};

const TAG_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'key',
        'name',
        'description',
        'color',
        'icon',
        'metadata',
        'imageAssetId',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        key: KEY_SCHEMA,
        name: NAME_SCHEMA,
        description: DESCRIPTION_SCHEMA,
        color: COLOR_SCHEMA,
        icon: ICON_SCHEMA,
        metadata: METADATA_SCHEMA,
        imageAssetId: IMAGE_ASSET_ID_SCHEMA,
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']},
        counts: {type: 'object', additionalProperties: true}
    }
};

const TAG_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: TAG_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const ASSIGNMENT_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: SUBJECT_REF_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const DELETED_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted', 'id'],
    properties: {
        deleted: {type: 'boolean'},
        id: {type: 'integer'}
    }
};

const TAG_SORT_BY: JsonSchema = {
    type: 'string',
    enum: ['key', 'name', 'createdAt', 'updatedAt']
};
const TAG_SORT_DIR: JsonSchema = {type: 'string', enum: ['asc', 'desc']};

// Key is optional on create — backend derives it from name if omitted.
export const TAG_CREATE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        key: KEY_SCHEMA,
        name: NAME_SCHEMA,
        description: DESCRIPTION_SCHEMA,
        color: COLOR_SCHEMA,
        icon: ICON_SCHEMA,
        metadata: METADATA_SCHEMA,
        imageAssetId: IMAGE_ASSET_ID_SCHEMA
    }
};

// Key is immutable in phase 1 (spec §8.4 Tag.Update).
export const TAG_UPDATE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'patch'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                description: DESCRIPTION_SCHEMA,
                color: COLOR_SCHEMA,
                icon: ICON_SCHEMA,
                metadata: METADATA_SCHEMA,
                imageAssetId: IMAGE_ASSET_ID_SCHEMA
            }
        }
    }
};

export const TAG_DELETE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const TAG_GET_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        includeSummary: {type: 'boolean'}
    }
};

export const TAG_LIST_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        query: {type: 'string', minLength: 1, maxLength: 120},
        key: KEY_SCHEMA,
        includeSummary: {type: 'boolean'},
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0},
        sortBy: TAG_SORT_BY,
        sortDir: TAG_SORT_DIR
    }
};

export const TAG_ASSIGN_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'subjects'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        subjects: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BATCH_SIZE,
            items: SUBJECT_REF_SCHEMA
        }
    }
};

export const TAG_UNASSIGN_PARAMS = TAG_ASSIGN_PARAMS;

export const TAG_LIST_ASSIGNMENTS_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        subjectType: SUBJECT_TYPE_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0}
    }
};

const ASSIGN_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'assigned'],
    properties: {
        id: {type: 'integer'},
        assigned: {type: 'array', items: SUBJECT_REF_SCHEMA}
    }
};

const UNASSIGN_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'unassigned'],
    properties: {
        id: {type: 'integer'},
        unassigned: {type: 'array', items: SUBJECT_REF_SCHEMA}
    }
};

export const TAG_DESCRIBE: DescribeOutput = new DescribeBuilder('tag', {
    kind: 'fleet-manager',
    description:
        'Manage labels and their subject assignments within the organization.'
})
    .registerMethod('Create', {
        params: TAG_CREATE_PARAMS,
        response: TAG_SCHEMA,
        permission: {component: 'tags', operation: 'create'},
        description:
            'Create a tag. Key auto-derived from name (slugified + uniquified) when omitted.'
    })
    .registerMethod('Update', {
        params: TAG_UPDATE_PARAMS,
        response: TAG_SCHEMA,
        permission: {component: 'tags', operation: 'update'},
        description: 'Partial-update a tag. Key is immutable in phase 1.'
    })
    .registerMethod('Delete', {
        params: TAG_DELETE_PARAMS,
        response: DELETED_SCHEMA,
        permission: {component: 'tags', operation: 'delete'},
        description:
            'Delete a tag. Assignment rows cascade-delete with the tag.'
    })
    .registerMethod('Get', {
        params: TAG_GET_PARAMS,
        response: TAG_SCHEMA,
        permission: {component: 'tags', operation: 'read'},
        description: 'Fetch one tag by id.'
    })
    .registerMethod('List', {
        params: TAG_LIST_PARAMS,
        response: TAG_LIST_ENVELOPE,
        permission: {component: 'tags', operation: 'read'},
        description: 'List tags with query/key filters and sort options.'
    })
    .registerMethod('Assign', {
        params: TAG_ASSIGN_PARAMS,
        response: ASSIGN_RESPONSE_SCHEMA,
        permission: {component: 'tags', operation: 'update'},
        description:
            'Batch-assign subjects to a tag. Idempotent: already-assigned rows are skipped.'
    })
    .registerMethod('Unassign', {
        params: TAG_UNASSIGN_PARAMS,
        response: UNASSIGN_RESPONSE_SCHEMA,
        permission: {component: 'tags', operation: 'update'},
        description:
            'Batch-remove subject assignments. Missing rows are silently skipped.'
    })
    .registerMethod('ListAssignments', {
        params: TAG_LIST_ASSIGNMENTS_PARAMS,
        response: ASSIGNMENT_LIST_ENVELOPE,
        permission: {component: 'tags', operation: 'read'},
        description:
            'List assignments for a tag with optional subject-type filter.'
    })
    .registerMethod('ListForSubject', {
        params: SUBJECT_REF_SCHEMA,
        response: {
            type: 'object',
            additionalProperties: false,
            required: ['tagIds'],
            properties: {
                tagIds: {
                    type: 'array',
                    items: {type: 'integer', minimum: 1}
                }
            }
        },
        permission: {component: 'tags', operation: 'read'},
        description: 'Tag IDs currently attached to one subject.'
    })
    .build();
