/** Public API types for the `group.*` namespace — logical collections over subjects. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    MAX_BATCH_SIZE,
    METADATA_SCHEMA,
    NAME_SCHEMA,
    ORG_ID_SCHEMA,
    SUMMARY_COUNTS_SCHEMA,
    type SummaryCounts
} from './_shared';
import {
    VISUAL_DECORATION_SCHEMA,
    type VisualDecoration
} from './_visualMetadata';
import {ALERT_SEVERITIES, type AlertSeverity} from './alert';

const UUID_SCHEMA: JsonSchema = {
    type: 'string',
    pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
};

// Sync with groups_type_valid CHECK in 2005_groups.sql.
export const GROUP_TYPES = [
    'standard',
    'operational',
    'critical',
    'custom'
] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
    standard: 'Standard',
    operational: 'Operational',
    critical: 'Critical',
    custom: 'Custom'
};

// Sync with group_member_subject_valid CHECK in 2005_groups.sql.
export const GROUP_MEMBER_SUBJECT_TYPES = [
    'device',
    'entity',
    'location'
] as const;
export type GroupMemberSubjectType =
    (typeof GROUP_MEMBER_SUBJECT_TYPES)[number];

export type MembershipMode = 'manual';

export interface Group {
    id: number;
    organizationId: string;
    name: string;
    description: string | null;
    parentGroupId: number | null;
    groupType: GroupType;
    membershipMode: MembershipMode;
    /** Typed-bucket classifier from the group_kind catalog. Defaults to 'manual'. */
    kind: string;
    metadata: Record<string, unknown>;
    /** Per-group decoration — empty object = no override, render uses groupType. */
    visual: VisualDecoration;
    /** Uploaded custom image URL (when set). Independent of visual.icon. */
    imageAssetId: string | null;
    /** Optimistic-concurrency revision; bumps on every successful update. */
    revision: number;
    /** Grandfathered group — name/metadata/members editable, parent change locked. */
    isLegacy: boolean;
    /** Resolved via `metadata.policy.severityFloor` OR env default for `groupType`. */
    effectiveSeverityFloor: AlertSeverity | null;
    /** Resolved via `metadata.policy.retentionDays` OR env default for `groupType`. */
    effectiveRetentionDays: number | null;
    /** Resolved via `metadata.policy.auditRetentionDays` OR env default for `groupType`. */
    effectiveAuditRetentionDays: number | null;
    /** Per-field provenance for the effective* values — `set` = explicit
     *  `metadata.policy.<key>`, `inherited` = fell through to the env default. */
    policySources?: {
        severityFloor: 'set' | 'inherited';
        retentionDays: 'set' | 'inherited';
        auditRetentionDays: 'set' | 'inherited';
    };
    createdAt: string;
    updatedAt: string | null;
    counts?: SummaryCounts;
}

export interface GroupMemberRef {
    subjectType: GroupMemberSubjectType;
    subjectId: string;
}

export interface GroupBreadcrumbEntry {
    id: number;
    name: string;
}

/** One row in a `Group.ListDeviceMemberships` response. */
export interface GroupDeviceMembership {
    groupId: number;
    subjectId: string;
}

/** Max members per `AddMembers`/`RemoveMembers` call — matches schema maxItems. */
export const GROUP_MEMBERS_MAX_PER_CALL = 500;

const DESCRIPTION_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    maxLength: 500
};
const GROUP_TYPE_SCHEMA: JsonSchema = {type: 'string', enum: [...GROUP_TYPES]};
const MEMBERSHIP_MODE_SCHEMA: JsonSchema = {type: 'string', enum: ['manual']};
const SUBJECT_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...GROUP_MEMBER_SUBJECT_TYPES]
};
const SUBJECT_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 255
};
const MEMBER_REF_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['subjectType', 'subjectId'],
    additionalProperties: false,
    properties: {
        subjectType: SUBJECT_TYPE_SCHEMA,
        subjectId: SUBJECT_ID_SCHEMA
    }
};

// Group-kind identifier — references the row id in organization.group_kind
// and the entries in backend/src/config/groupKindCatalog.ts.
const GROUP_KIND_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 64
};

const GROUP_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'name',
        'description',
        'parentGroupId',
        'groupType',
        'membershipMode',
        'kind',
        'metadata',
        'visual',
        'imageAssetId',
        'revision',
        'isLegacy',
        'effectiveSeverityFloor',
        'effectiveRetentionDays',
        'effectiveAuditRetentionDays',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        description: DESCRIPTION_SCHEMA,
        parentGroupId: {type: ['integer', 'null']},
        groupType: GROUP_TYPE_SCHEMA,
        membershipMode: MEMBERSHIP_MODE_SCHEMA,
        kind: GROUP_KIND_ID_SCHEMA,
        metadata: METADATA_SCHEMA,
        visual: VISUAL_DECORATION_SCHEMA,
        imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        revision: {type: 'integer', minimum: 1},
        isLegacy: {type: 'boolean'},
        effectiveSeverityFloor: {
            type: ['string', 'null'],
            enum: [...ALERT_SEVERITIES, null]
        },
        effectiveRetentionDays: {type: ['integer', 'null'], minimum: 1},
        effectiveAuditRetentionDays: {type: ['integer', 'null'], minimum: 1},
        policySources: {
            type: 'object',
            required: ['severityFloor', 'retentionDays', 'auditRetentionDays'],
            additionalProperties: false,
            properties: {
                severityFloor: {type: 'string', enum: ['set', 'inherited']},
                retentionDays: {type: 'string', enum: ['set', 'inherited']},
                auditRetentionDays: {
                    type: 'string',
                    enum: ['set', 'inherited']
                }
            }
        },
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']},
        counts: SUMMARY_COUNTS_SCHEMA
    }
};

const GROUP_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: GROUP_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const MEMBER_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: MEMBER_REF_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const BREADCRUMB_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'name'],
    properties: {
        id: {type: 'integer'},
        name: {type: 'string'}
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

const SORT_BY_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['name', 'groupType', 'createdAt', 'updatedAt']
};
const SORT_DIR_SCHEMA: JsonSchema = {type: 'string', enum: ['asc', 'desc']};

export const GROUP_CREATE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        description: DESCRIPTION_SCHEMA,
        groupType: GROUP_TYPE_SCHEMA,
        kind: GROUP_KIND_ID_SCHEMA,
        metadata: METADATA_SCHEMA
    }
};

export const GROUP_UPDATE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'patch'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        expectedRevision: {type: 'integer', minimum: 1},
        patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                description: DESCRIPTION_SCHEMA,
                groupType: GROUP_TYPE_SCHEMA,
                kind: GROUP_KIND_ID_SCHEMA,
                metadata: METADATA_SCHEMA,
                visual: VISUAL_DECORATION_SCHEMA,
                imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]}
            }
        }
    }
};

export const GROUP_DELETE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const GROUP_GET_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        includeSummary: {type: 'boolean'}
    }
};

export const GROUP_LIST_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        parentGroupId: {type: ['integer', 'null']},
        query: {type: 'string', minLength: 1, maxLength: 120},
        groupType: GROUP_TYPE_SCHEMA,
        includeSummary: {type: 'boolean'},
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0},
        sortBy: SORT_BY_SCHEMA,
        sortDir: SORT_DIR_SCHEMA
    }
};

export const GROUP_CHILDREN_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        includeSummary: {type: 'boolean'},
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0}
    }
};

export const GROUP_PATH_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const GROUP_MEMBERS_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'members'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        members: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BATCH_SIZE,
            items: MEMBER_REF_SCHEMA
        }
    }
};

export const GROUP_LIST_MEMBERS_PARAMS: JsonSchema = {
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

export const GROUP_LIST_DEVICE_MEMBERSHIPS_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        ids: {
            type: 'array',
            items: {type: 'integer'},
            minItems: 1,
            maxItems: 1000
        }
    }
};

// Group activity timeline — one row per audit_log entry whose subject
// (shelly_id, or any of shelly_ids for bulk-op rows) is a device member
// of the group (or its descendants when enabled).
export interface GroupActivityEntry {
    auditId: number;
    ts: string;
    eventType: string;
    username: string | null;
    shellyId: string | null;
    shellyIds: string[];
    method: string | null;
    params: Record<string, unknown>;
    success: boolean;
    errorMessage: string | null;
}

const GROUP_ACTIVITY_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'auditId',
        'ts',
        'eventType',
        'username',
        'shellyId',
        'shellyIds',
        'method',
        'params',
        'success',
        'errorMessage'
    ],
    properties: {
        auditId: {type: 'integer'},
        ts: {type: 'string'},
        eventType: {type: 'string', minLength: 1, maxLength: 50},
        username: {type: ['string', 'null']},
        shellyId: {type: ['string', 'null']},
        shellyIds: {type: 'array', items: {type: 'string'}},
        method: {type: ['string', 'null']},
        params: {type: 'object', additionalProperties: true},
        success: {type: 'boolean'},
        errorMessage: {type: ['string', 'null']}
    }
};

export const GROUP_LIST_ACTIVITY_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        from: {type: 'string', minLength: 1},
        to: {type: 'string', minLength: 1},
        eventTypes: {
            type: 'array',
            items: {type: 'string', minLength: 1, maxLength: 50},
            maxItems: 50
        },
        includeDescendants: {type: 'boolean', default: true},
        limit: {type: 'integer', minimum: 1, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

const GROUP_LIST_ACTIVITY_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: GROUP_ACTIVITY_ENTRY_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const MEMBERSHIP_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['groupId', 'subjectId'],
    additionalProperties: false,
    properties: {
        groupId: {type: 'integer'},
        subjectId: SUBJECT_ID_SCHEMA
    }
};

const MEMBERSHIP_LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {
        items: {type: 'array', items: MEMBERSHIP_ENTRY_SCHEMA}
    }
};

const ADD_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'added'],
    properties: {
        id: {type: 'integer'},
        added: {type: 'array', items: MEMBER_REF_SCHEMA}
    }
};

const REMOVE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'removed'],
    properties: {
        id: {type: 'integer'},
        removed: {type: 'array', items: MEMBER_REF_SCHEMA}
    }
};

// --- Group kinds (typed group catalog) ----------------------------------

/**
 * One row in the kind catalog. Every group carries a `kind` foreign-keyed
 * to this catalog. `metadata_schema` describes the per-kind fields the
 * application layer validates `group.metadata` against on Create/Update.
 */
export interface GroupKind {
    id: string;
    displayName: string;
    description: string | null;
    /** Frontend filter axis — 'electrical' | 'industrial' | 'property' | … */
    category: string;
    icon: string | null;
    /** JSON Schema describing the kind-specific metadata fields. */
    metadataSchema: Record<string, unknown>;
    sortOrder: number;
}

const GROUP_KIND_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'displayName',
        'description',
        'category',
        'icon',
        'metadataSchema',
        'sortOrder'
    ],
    properties: {
        id: {type: 'string', minLength: 1, maxLength: 64},
        displayName: {type: 'string', minLength: 1, maxLength: 120},
        description: {type: ['string', 'null']},
        category: {type: 'string', minLength: 1, maxLength: 32},
        icon: {type: ['string', 'null'], maxLength: 80},
        metadataSchema: {type: 'object', additionalProperties: true},
        sortOrder: {type: 'integer'}
    }
};

export interface GroupKindListParams {
    /** Filter by category. Omit to return all kinds. */
    category?: string;
    /** Case-insensitive substring search across displayName + description. */
    query?: string;
}

export const GROUP_KIND_LIST_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        category: {type: 'string', minLength: 1, maxLength: 32},
        query: {type: 'string', minLength: 1, maxLength: 80}
    }
};

export const GROUP_KIND_LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {
        items: {type: 'array', items: GROUP_KIND_SCHEMA}
    }
};

export interface GroupKindGetParams {
    id: string;
}

export const GROUP_KIND_GET_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        id: {type: 'string', minLength: 1, maxLength: 64}
    }
};

export const GROUP_DESCRIBE: DescribeOutput = new DescribeBuilder('group', {
    kind: 'fleet-manager',
    description: 'Manage hierarchical groups and their subject memberships.'
})
    .registerMethod('Create', {
        params: GROUP_CREATE_PARAMS,
        response: GROUP_SCHEMA,
        permission: {component: 'groups', operation: 'create'},
        description: 'Create a group. Unique sibling-name per parent.'
    })
    .registerMethod('Update', {
        params: GROUP_UPDATE_PARAMS,
        response: GROUP_SCHEMA,
        permission: {component: 'groups', operation: 'update'},
        description: 'Partial-update a group. Cycle-safe parent changes.'
    })
    .registerMethod('Delete', {
        params: GROUP_DELETE_PARAMS,
        response: DELETED_SCHEMA,
        permission: {component: 'groups', operation: 'delete'},
        description:
            'Delete a group. Rejected if it has child groups. Members cascade.'
    })
    .registerMethod('Get', {
        params: GROUP_GET_PARAMS,
        response: GROUP_SCHEMA,
        permission: {component: 'groups', operation: 'read'},
        description: 'Fetch one group by id.'
    })
    .registerMethod('List', {
        params: GROUP_LIST_PARAMS,
        response: GROUP_LIST_ENVELOPE,
        permission: {component: 'groups', operation: 'read'},
        description:
            'List groups. Optional parent filter: omit = all, null = roots only, integer = children of that parent.'
    })
    .registerMethod('Children', {
        params: GROUP_CHILDREN_PARAMS,
        response: GROUP_LIST_ENVELOPE,
        permission: {component: 'groups', operation: 'read'},
        description: 'Direct children of the given group.'
    })
    .registerMethod('Path', {
        params: GROUP_PATH_PARAMS,
        response: {
            type: 'object',
            required: ['items'],
            properties: {
                items: {type: 'array', items: BREADCRUMB_ENTRY_SCHEMA}
            }
        },
        permission: {component: 'groups', operation: 'read'},
        description: 'Breadcrumb from root to the given group.'
    })
    .registerMethod('ListMembers', {
        params: GROUP_LIST_MEMBERS_PARAMS,
        response: MEMBER_LIST_ENVELOPE,
        permission: {component: 'groups', operation: 'read'},
        description:
            'List members of a group with optional subject-type filter.'
    })
    .registerMethod('ListDeviceMemberships', {
        params: GROUP_LIST_DEVICE_MEMBERSHIPS_PARAMS,
        response: MEMBERSHIP_LIST_RESPONSE,
        permission: {component: 'groups', operation: 'read'},
        description:
            'Flat {groupId, subjectId} list of device memberships — one round-trip for UIs that render many groups at once. Optional `ids` narrows the scope; otherwise returns all groups the caller can read.'
    })
    .registerMethod('AddMembers', {
        params: GROUP_MEMBERS_PARAMS,
        response: ADD_RESPONSE_SCHEMA,
        permission: {component: 'groups', operation: 'update'},
        description:
            'Batch-add subject members. Idempotent: already-present rows skipped.'
    })
    .registerMethod('RemoveMembers', {
        params: GROUP_MEMBERS_PARAMS,
        response: REMOVE_RESPONSE_SCHEMA,
        permission: {component: 'groups', operation: 'update'},
        description: 'Batch-remove subject members.'
    })
    .registerMethod('ListActivity', {
        params: GROUP_LIST_ACTIVITY_PARAMS,
        response: GROUP_LIST_ACTIVITY_RESPONSE,
        permission: {component: 'groups', operation: 'read'},
        description:
            'Paginated audit-log timeline for devices that are members of the group (or its descendants). Filter by time window and event types.'
    })
    .registerMethod('Kind.List', {
        params: GROUP_KIND_LIST_PARAMS,
        response: GROUP_KIND_LIST_RESPONSE,
        permission: {component: 'groups', operation: 'read'},
        description:
            'List group kinds. Optional `category` filter narrows to one bucket family.'
    })
    .registerMethod('Kind.Get', {
        params: GROUP_KIND_GET_PARAMS,
        response: GROUP_KIND_SCHEMA,
        permission: {component: 'groups', operation: 'read'},
        description: 'Fetch one group kind by id.'
    })
    .build();
