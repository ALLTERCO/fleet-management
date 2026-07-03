/**
 * Public API types for the `notification.*` namespace.
 *
 * This namespace exposes:
 * - push-token registration
 * - per-user inbox read state
 * - destination-group CRUD + member management
 * - delivery history (jobs + attempts)
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    EMAIL_ATTACHMENTS_SCHEMA,
    type EmailAttachment,
    NAME_SCHEMA,
    ORG_ID_SCHEMA
} from './_shared';
import {ALERT_SOURCE_REF_SCHEMA, type AlertSourceRef} from './alert';
import {CHANNEL_PROVIDERS} from './channel';
import {EMPTY_PARAMS_SCHEMA, UPLOAD_TICKET_RESPONSE_SCHEMA} from './upload';

export const NOTIFICATION_KINDS = [
    'alert_created',
    'alert_updated',
    'alert_resolved',
    'alert_digest'
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const INBOX_STATES = ['unread', 'read'] as const;
export type InboxState = (typeof INBOX_STATES)[number];

export const NOTIFICATION_INBOX_ACTIONS = [
    'mark_read',
    'mark_unread',
    'acknowledge_alert',
    'unacknowledge_alert',
    'silence_alert',
    'unsilence_alert',
    'open_source'
] as const;
export type NotificationInboxAction =
    (typeof NOTIFICATION_INBOX_ACTIONS)[number];

export interface NotificationInboxItem {
    id: number;
    organizationId: string;
    userId: string;
    kind: NotificationKind;
    state: InboxState;
    alertId: number | null;
    source: AlertSourceRef | null;
    title: string;
    message: string;
    createdAt: string;
    readAt: string | null;
    availableActions: NotificationInboxAction[];
}

export interface NotificationOnCallSchedule {
    id: number;
    organizationId: string;
    name: string;
    timezone: string;
    rotationRules: unknown[];
    overrides: unknown[];
    target: Record<string, unknown>;
    enabled: boolean;
    createdAt: string;
    updatedAt: string | null;
}

export interface NotificationRoutingPolicy {
    id: number;
    organizationId: string;
    parentPolicyId: number | null;
    name: string;
    sortOrder: number;
    labelMatchers: unknown[];
    severityMatchers: string[];
    resourceSelectors: unknown[];
    contactPoints: unknown[];
    groupingKeys: string[];
    muteWindows: unknown[];
    runtimeSilences: unknown[];
    inhibitionRules: unknown[];
    escalationStages: unknown[];
    enabled: boolean;
    createdAt: string;
    updatedAt: string | null;
}

const EMPTY_OBJECT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

const QUERY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120
};

const LIMIT_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1,
    maximum: 1000,
    default: 200
};

const OFFSET_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 0,
    default: 0
};

const NOTIFICATION_KIND_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...NOTIFICATION_KINDS]
};

const INBOX_STATE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...INBOX_STATES]
};

const NOTIFICATION_INBOX_ACTION_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...NOTIFICATION_INBOX_ACTIONS]
};

const OPTIONAL_SOURCE_SCHEMA: JsonSchema = {
    anyOf: [ALERT_SOURCE_REF_SCHEMA, {type: 'null'}]
};

export const NOTIFICATION_SUBSCRIBE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['token'],
    properties: {
        token: {
            type: 'string',
            minLength: 1,
            description: 'Device push token (FCM / APNs / web push)'
        }
    }
};

export const NOTIFICATION_SUBSCRIBE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'userId'],
    properties: {
        id: {type: ['integer', 'null']},
        token: {type: 'string'},
        userId: {type: 'string'}
    }
};

export const NOTIFICATION_LIST_TOKENS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        limit: {type: 'integer', minimum: 0, maximum: 1000},
        offset: {type: 'integer', minimum: 0}
    }
};

const TOKEN_ROW_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        id: {type: ['integer', 'null']},
        token: {type: ['string', 'null']},
        userId: {type: ['string', 'null']},
        created: {type: ['string', 'null']},
        updated: {type: ['string', 'null']}
    }
};

export const NOTIFICATION_LIST_TOKENS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: TOKEN_ROW_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const NOTIFICATION_INBOX_ITEM_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'userId',
        'kind',
        'state',
        'alertId',
        'source',
        'title',
        'message',
        'createdAt',
        'readAt',
        'availableActions'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        userId: {type: 'string', minLength: 1, maxLength: 255},
        kind: NOTIFICATION_KIND_SCHEMA,
        state: INBOX_STATE_SCHEMA,
        alertId: {type: ['integer', 'null']},
        source: OPTIONAL_SOURCE_SCHEMA,
        title: {type: 'string', minLength: 1, maxLength: 255},
        message: {type: 'string'},
        createdAt: {type: 'string'},
        readAt: {type: ['string', 'null']},
        availableActions: {
            type: 'array',
            items: NOTIFICATION_INBOX_ACTION_SCHEMA
        }
    }
};

export const NOTIFICATION_INBOX_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        state: INBOX_STATE_SCHEMA,
        kind: NOTIFICATION_KIND_SCHEMA,
        query: QUERY_SCHEMA,
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const NOTIFICATION_INBOX_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: NOTIFICATION_INBOX_ITEM_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const NOTIFICATION_INBOX_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const NOTIFICATION_INBOX_MARK_READ_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const NOTIFICATION_INBOX_MARK_UNREAD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const NOTIFICATION_INBOX_MARK_ALL_READ_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA
    }
};

export const NOTIFICATION_INBOX_UPDATED_COUNT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['updatedCount'],
    properties: {
        updatedCount: {type: 'integer', minimum: 0}
    }
};

// --- Destinations --------------------------------------------------------

/** Phase-1 lock — no team members, no nested groups, no escalation. */
export const DESTINATION_MEMBER_TYPES = [
    'user',
    'channel',
    'push_token'
] as const;
export type DestinationMemberType = (typeof DESTINATION_MEMBER_TYPES)[number];

export interface DestinationMemberRef {
    memberType: DestinationMemberType;
    memberId: string;
}

export interface DestinationGroupCounts {
    members: number;
    rulesReferencing: number;
}

export interface DestinationGroup {
    id: number;
    organizationId: string;
    name: string;
    description: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string | null;
    counts: DestinationGroupCounts;
}

/** Static capability descriptor returned by Destination.GetModel. */
export interface DestinationModel {
    version: 1;
    memberTypes: DestinationMemberType[];
    capabilities: {
        nestedGroups: false;
        teamMembers: false;
        escalationLevels: false;
    };
}

const DESTINATION_MEMBER_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DESTINATION_MEMBER_TYPES]
};

const DESTINATION_MEMBER_REF_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['memberType', 'memberId'],
    properties: {
        memberType: DESTINATION_MEMBER_TYPE_SCHEMA,
        memberId: {type: 'string', minLength: 1, maxLength: 255}
    }
};

const DESTINATION_GROUP_COUNTS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['members', 'rulesReferencing'],
    properties: {
        members: {type: 'integer', minimum: 0},
        rulesReferencing: {type: 'integer', minimum: 0}
    }
};

export const DESTINATION_GROUP_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'name',
        'description',
        'enabled',
        'createdAt',
        'updatedAt',
        'counts'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 120},
        description: {type: ['string', 'null'], maxLength: 500},
        enabled: {type: 'boolean'},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']},
        counts: DESTINATION_GROUP_COUNTS_SCHEMA
    }
};

const DELETED_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'id'],
    properties: {
        deleted: {type: 'boolean'},
        id: {type: 'integer'}
    }
};

/** Max members per AddMembers/RemoveMembers call — matches Group pattern. */
export const DESTINATION_MEMBERS_MAX_PER_CALL = 500;

const DESTINATION_MEMBERS_BATCH_SCHEMA: JsonSchema = {
    type: 'array',
    items: DESTINATION_MEMBER_REF_SCHEMA,
    minItems: 1,
    maxItems: DESTINATION_MEMBERS_MAX_PER_CALL
};

export const DESTINATION_GET_MODEL_PARAMS_SCHEMA: JsonSchema =
    EMPTY_OBJECT_SCHEMA;

export const DESTINATION_MODEL_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'memberTypes', 'capabilities'],
    properties: {
        version: {type: 'integer', const: 1},
        memberTypes: {type: 'array', items: DESTINATION_MEMBER_TYPE_SCHEMA},
        capabilities: {
            type: 'object',
            additionalProperties: false,
            required: ['nestedGroups', 'teamMembers', 'escalationLevels'],
            properties: {
                nestedGroups: {type: 'boolean', const: false},
                teamMembers: {type: 'boolean', const: false},
                escalationLevels: {type: 'boolean', const: false}
            }
        }
    }
};

export const DESTINATION_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        enabled: {type: 'boolean'},
        query: QUERY_SCHEMA,
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const DESTINATION_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: DESTINATION_GROUP_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const DESTINATION_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const DESTINATION_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 120},
        description: {type: ['string', 'null'], maxLength: 500},
        enabled: {type: 'boolean'}
    }
};

export const DESTINATION_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'patch'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: {type: 'string', minLength: 1, maxLength: 120},
                description: {type: ['string', 'null'], maxLength: 500},
                enabled: {type: 'boolean'}
            }
        }
    }
};

export const DESTINATION_DELETE_PARAMS_SCHEMA: JsonSchema =
    DESTINATION_GET_PARAMS_SCHEMA;

export const DESTINATION_LIST_MEMBERS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const DESTINATION_MEMBER_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: DESTINATION_MEMBER_REF_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const DESTINATION_ADD_MEMBERS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'members'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        members: DESTINATION_MEMBERS_BATCH_SCHEMA
    }
};

export const DESTINATION_ADD_MEMBERS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'added'],
    properties: {
        id: {type: 'integer'},
        added: {type: 'array', items: DESTINATION_MEMBER_REF_SCHEMA}
    }
};

export const DESTINATION_REMOVE_MEMBERS_PARAMS_SCHEMA: JsonSchema =
    DESTINATION_ADD_MEMBERS_PARAMS_SCHEMA;

export const DESTINATION_REMOVE_MEMBERS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'removed'],
    properties: {
        id: {type: 'integer'},
        removed: {type: 'array', items: DESTINATION_MEMBER_REF_SCHEMA}
    }
};

// --- Delivery history ----------------------------------------------------

export const DELIVERY_JOB_STATES = [
    'queued',
    'processing',
    'succeeded',
    'failed',
    'superseded',
    'dead_letter'
] as const;
export type DeliveryJobState = (typeof DELIVERY_JOB_STATES)[number];

export const DELIVERY_ATTEMPT_STATES = ['succeeded', 'failed'] as const;
export type DeliveryAttemptState = (typeof DELIVERY_ATTEMPT_STATES)[number];

export interface DeliveryJob {
    id: number;
    organizationId: string;
    alertId: number | null;
    inboxItemId: number | null;
    channelId: number;
    state: DeliveryJobState;
    createdAt: string;
    completedAt: string | null;
    attemptCount: number;
}

export interface DeliveryAttempt {
    id: number;
    jobId: number;
    channelId: number;
    state: DeliveryAttemptState;
    attemptedAt: string;
    httpStatus: number | null;
    providerCode: string | null;
    errorMessage: string | null;
}

const DELIVERY_JOB_STATE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DELIVERY_JOB_STATES]
};

const DELIVERY_ATTEMPT_STATE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DELIVERY_ATTEMPT_STATES]
};

const CHANNEL_PROVIDER_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...CHANNEL_PROVIDERS]
};

export const DELIVERY_JOB_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'alertId',
        'inboxItemId',
        'channelId',
        'state',
        'createdAt',
        'completedAt',
        'attemptCount'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        alertId: {type: ['integer', 'null']},
        inboxItemId: {type: ['integer', 'null']},
        channelId: {type: 'integer'},
        state: DELIVERY_JOB_STATE_SCHEMA,
        createdAt: {type: 'string'},
        completedAt: {type: ['string', 'null']},
        attemptCount: {type: 'integer', minimum: 0}
    }
};

export const DELIVERY_ATTEMPT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'jobId',
        'channelId',
        'state',
        'attemptedAt',
        'httpStatus',
        'providerCode',
        'errorMessage'
    ],
    properties: {
        id: {type: 'integer'},
        jobId: {type: 'integer'},
        channelId: {type: 'integer'},
        state: DELIVERY_ATTEMPT_STATE_SCHEMA,
        attemptedAt: {type: 'string'},
        httpStatus: {type: ['integer', 'null']},
        providerCode: {type: ['string', 'null']},
        errorMessage: {type: ['string', 'null']}
    }
};

export const NOTIFICATION_HISTORY_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        channelId: {type: 'integer'},
        state: DELIVERY_JOB_STATE_SCHEMA,
        provider: CHANNEL_PROVIDER_SCHEMA,
        alertId: {type: 'integer'},
        from: {type: 'string', format: 'date-time'},
        to: {type: 'string', format: 'date-time'},
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const NOTIFICATION_HISTORY_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: DELIVERY_JOB_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const NOTIFICATION_HISTORY_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const NOTIFICATION_HISTORY_GET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['job', 'attempts'],
    properties: {
        job: DELIVERY_JOB_SCHEMA,
        attempts: {type: 'array', items: DELIVERY_ATTEMPT_SCHEMA}
    }
};

export const NOTIFICATION_HISTORY_REQUEUE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

// Notification.RenderTemplate — UI-facing preview for the rule form.
// Accepts a template string + optional alert/rule context source, returns
// the rendered output plus missing-token warnings. The renderer is the
// exact one the delivery pipeline uses, so preview output is authoritative.
export interface TemplateTokenDescriptor {
    token: string;
    label: string;
    description: string;
    example: string;
}

const TEMPLATE_TOKEN_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'label', 'description', 'example'],
    properties: {
        token: {type: 'string', minLength: 1, maxLength: 120},
        label: {type: 'string', minLength: 1, maxLength: 120},
        description: {type: 'string', maxLength: 500},
        example: {type: 'string', maxLength: 500}
    }
};

export const NOTIFICATION_RENDER_TEMPLATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['template'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        template: {type: 'string', minLength: 1, maxLength: 8000},
        // If provided, preview uses this real alert's context.
        sampleAlertId: {type: 'integer', minimum: 1},
        // Otherwise we synthesize a sample for the rule kind.
        ruleKind: {
            type: 'string',
            minLength: 1,
            maxLength: 64
        },
        ruleName: {type: 'string', minLength: 1, maxLength: 120}
    }
};

// Preview source precedence: inline fields > emailTemplateId > channelId.
export const NOTIFICATION_RENDER_EMAIL_PREVIEW_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        channelId: {type: 'integer', minimum: 1},
        emailTemplateId: {type: 'integer', minimum: 1},
        subjectTemplate: {type: 'string', minLength: 1, maxLength: 998},
        htmlTemplate: {type: 'string', minLength: 1, maxLength: 32000},
        textTemplate: {type: 'string', minLength: 1, maxLength: 8000},
        attachments: EMAIL_ATTACHMENTS_SCHEMA,
        // Sample-context routing, same shape as RenderTemplate.
        sampleAlertId: {type: 'integer', minimum: 1},
        ruleKind: {type: 'string', minLength: 1, maxLength: 64},
        ruleName: {type: 'string', minLength: 1, maxLength: 120}
    }
};

const PROBED_ATTACHMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['filename', 'url', 'reachable'],
    properties: {
        filename: {type: 'string'},
        url: {type: 'string'},
        cid: {type: 'string'},
        contentType: {type: 'string'},
        reachable: {type: 'boolean'},
        error: {type: 'string'}
    }
};

export const NOTIFICATION_RENDER_EMAIL_PREVIEW_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'subject',
        'html',
        'text',
        'missingTokens',
        'truncated',
        'attachments'
    ],
    properties: {
        subject: {type: 'string'},
        html: {type: 'string'},
        text: {type: 'string'},
        missingTokens: {type: 'array', items: {type: 'string'}},
        truncated: {type: 'boolean'},
        attachments: {type: 'array', items: PROBED_ATTACHMENT_SCHEMA}
    }
};

export const NOTIFICATION_RENDER_TEMPLATE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['rendered', 'missingTokens', 'truncated', 'tokens'],
    properties: {
        rendered: {type: 'string'},
        missingTokens: {type: 'array', items: {type: 'string'}},
        truncated: {type: 'boolean'},
        tokens: {type: 'array', items: TEMPLATE_TOKEN_SCHEMA}
    }
};

// ── Email template library (Phase-C reusable templates) ──────────────
// Save subject/html/text bodies once under a name; reference by id from
// one or many email_smtp endpoints via config.emailTemplateId.

export type {EmailAttachment};

export interface EmailTemplate {
    id: number;
    organizationId: string;
    name: string;
    description: string | null;
    subjectTemplate: string | null;
    htmlTemplate: string | null;
    textTemplate: string | null;
    attachments: EmailAttachment[];
    createdAt: string;
    updatedAt: string | null;
}

const EMAIL_TEMPLATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'name',
        'description',
        'subjectTemplate',
        'htmlTemplate',
        'textTemplate',
        'attachments',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer', minimum: 1},
        organizationId: ORG_ID_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 200},
        description: {type: ['string', 'null'], maxLength: 2000},
        subjectTemplate: {type: ['string', 'null'], maxLength: 998},
        htmlTemplate: {type: ['string', 'null'], maxLength: 32000},
        textTemplate: {type: ['string', 'null'], maxLength: 8000},
        attachments: EMAIL_ATTACHMENTS_SCHEMA,
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const NOTIFICATION_EMAIL_TEMPLATE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

export const NOTIFICATION_EMAIL_TEMPLATE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: EMAIL_TEMPLATE_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export const NOTIFICATION_EMAIL_TEMPLATE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer', minimum: 1}
    }
};

export const NOTIFICATION_EMAIL_TEMPLATE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 200},
        description: {type: 'string', maxLength: 2000},
        subjectTemplate: {type: 'string', minLength: 1, maxLength: 998},
        htmlTemplate: {type: 'string', minLength: 1, maxLength: 32000},
        textTemplate: {type: 'string', minLength: 1, maxLength: 8000},
        attachments: EMAIL_ATTACHMENTS_SCHEMA
    }
};

export const NOTIFICATION_EMAIL_TEMPLATE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer', minimum: 1},
        name: {type: 'string', minLength: 1, maxLength: 200},
        description: {type: ['string', 'null'], maxLength: 2000},
        subjectTemplate: {type: ['string', 'null'], maxLength: 998},
        htmlTemplate: {type: ['string', 'null'], maxLength: 32000},
        textTemplate: {type: ['string', 'null'], maxLength: 8000},
        attachments: EMAIL_ATTACHMENTS_SCHEMA
    }
};

export const NOTIFICATION_EMAIL_TEMPLATE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer', minimum: 1}
    }
};

export const NOTIFICATION_EMAIL_TEMPLATE_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

// ── Multi-channel message templates ──────────────────────────────────────
// A reusable message a rule or an endpoint can point at: per-channel bodies
// for email/slack/teams plus a required plain-text fallback used for every
// other channel (and whenever a channel body is absent).

/** Channels that have a dedicated template body. */
export const MESSAGE_TEMPLATE_CHANNELS = ['email', 'slack', 'teams'] as const;
export type MessageTemplateChannel = (typeof MESSAGE_TEMPLATE_CHANNELS)[number];

export interface MessageTemplateBodies {
    email?: {subject: string; html: string; text: string};
    /** Block Kit JSON string, or plain/mrkdwn text. */
    slack?: {blocks: string};
    /** Adaptive Card JSON string. */
    teams?: {card: string};
}

export interface MessageTemplate {
    id: number;
    organizationId: string;
    name: string;
    description: string | null;
    bodies: MessageTemplateBodies;
    /** Required. Used when a channel has no dedicated body. */
    fallbackText: string;
    createdAt: string;
    updatedAt: string | null;
}

const MESSAGE_TEMPLATE_BODIES_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        email: {
            type: 'object',
            additionalProperties: false,
            required: ['subject', 'html', 'text'],
            properties: {
                subject: {type: 'string', maxLength: 998},
                html: {type: 'string', maxLength: 32_000},
                text: {type: 'string', maxLength: 16_000}
            }
        },
        slack: {
            type: 'object',
            additionalProperties: false,
            required: ['blocks'],
            properties: {blocks: {type: 'string', maxLength: 16_000}}
        },
        teams: {
            type: 'object',
            additionalProperties: false,
            required: ['card'],
            properties: {card: {type: 'string', maxLength: 16_000}}
        }
    }
};

export const MESSAGE_TEMPLATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'name',
        'description',
        'bodies',
        'fallbackText',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        description: {type: ['string', 'null']},
        bodies: MESSAGE_TEMPLATE_BODIES_SCHEMA,
        fallbackText: {type: 'string', minLength: 1, maxLength: 16_000},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const MESSAGE_TEMPLATE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {organizationId: ORG_ID_SCHEMA}
};
export const MESSAGE_TEMPLATE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {items: {type: 'array', items: MESSAGE_TEMPLATE_SCHEMA}}
};
export const MESSAGE_TEMPLATE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {organizationId: ORG_ID_SCHEMA, id: {type: 'integer'}}
};
export const MESSAGE_TEMPLATE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'fallbackText'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        description: {type: ['string', 'null']},
        bodies: MESSAGE_TEMPLATE_BODIES_SCHEMA,
        fallbackText: {type: 'string', minLength: 1, maxLength: 16_000}
    }
};
export const MESSAGE_TEMPLATE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'patch'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                description: {type: ['string', 'null']},
                bodies: MESSAGE_TEMPLATE_BODIES_SCHEMA,
                fallbackText: {type: 'string', minLength: 1, maxLength: 16_000}
            }
        }
    }
};
export const MESSAGE_TEMPLATE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {organizationId: ORG_ID_SCHEMA, id: {type: 'integer'}}
};
export const MESSAGE_TEMPLATE_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

// ── Email asset library (binary blobs stored in notifications.email_assets)
// ── Upload lives at POST /api/notifications/email-assets (multipart).
// ── Inline download at GET  /api/notifications/email-assets/:id.
// ── List / Get metadata / Delete go through these RPCs.

export interface EmailAsset {
    id: number;
    organizationId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
}

const EMAIL_ASSET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'filename',
        'contentType',
        'sizeBytes',
        'sha256',
        'createdAt'
    ],
    properties: {
        id: {type: 'integer', minimum: 1},
        organizationId: ORG_ID_SCHEMA,
        filename: {type: 'string'},
        contentType: {type: 'string'},
        sizeBytes: {type: 'integer', minimum: 1},
        sha256: {type: 'string', minLength: 64, maxLength: 64},
        createdAt: {type: 'string'}
    }
};

export const NOTIFICATION_EMAIL_ASSET_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

export const NOTIFICATION_EMAIL_ASSET_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: EMAIL_ASSET_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export const NOTIFICATION_EMAIL_ASSET_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer', minimum: 1}
    }
};

export const NOTIFICATION_EMAIL_ASSET_DELETE_PARAMS_SCHEMA: JsonSchema =
    NOTIFICATION_EMAIL_ASSET_GET_PARAMS_SCHEMA;

export const NOTIFICATION_EMAIL_ASSET_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

// ── OAuth consent bootstrap (Gmail / M365). Paired with the HTTP
// ── callback at GET /api/oauth/callback/email.

export const NOTIFICATION_OAUTH_START_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['provider', 'channelId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        channelId: {type: 'integer', minimum: 1},
        provider: {
            type: 'string',
            enum: ['oauth2_google', 'oauth2_microsoft']
        },
        tenant: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export const NOTIFICATION_OAUTH_START_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['authUrl', 'state', 'expiresAt'],
    properties: {
        authUrl: {type: 'string'},
        state: {type: 'string'},
        expiresAt: {type: 'string'}
    }
};

const NOTIFICATION_BUNDLE_OBJECT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    maxBytes: 512 * 1024
};

const NOTIFICATION_BUNDLE_WARNING_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'message'],
    properties: {
        path: {type: 'string'},
        message: {type: 'string'}
    }
};

export const NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['bundle'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        bundle: NOTIFICATION_BUNDLE_OBJECT_SCHEMA,
        channelMappings: {
            type: 'object',
            additionalProperties: {type: 'integer', minimum: 1}
        }
    }
};

export const NOTIFICATION_BUNDLE_EXPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA
    }
};

export const NOTIFICATION_BUNDLE_IMPORT_EXTERNAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['config'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        config: NOTIFICATION_BUNDLE_OBJECT_SCHEMA
    }
};

export const NOTIFICATION_BUNDLE_DRY_RUN_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['dryRun', 'bundle', 'warnings'],
    properties: {
        dryRun: {type: 'boolean', const: true},
        bundle: NOTIFICATION_BUNDLE_OBJECT_SCHEMA,
        warnings: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_WARNING_SCHEMA
        }
    }
};

export const NOTIFICATION_BUNDLE_EXPORT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['dryRun', 'config', 'warnings'],
    properties: {
        dryRun: {type: 'boolean', const: true},
        config: NOTIFICATION_BUNDLE_OBJECT_SCHEMA,
        warnings: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_WARNING_SCHEMA
        }
    }
};

const NOTIFICATION_BUNDLE_IMPORT_OPERATION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'resourceType',
        'key',
        'action',
        'message',
        'conflicts',
        'requiresSecretMapping',
        'mappingKeys'
    ],
    properties: {
        resourceType: {
            type: 'string',
            enum: ['routing_policy', 'on_call_schedule', 'channel']
        },
        key: {type: 'string'},
        action: {
            type: 'string',
            enum: ['create', 'update', 'unsupported']
        },
        message: {type: 'string'},
        conflicts: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_WARNING_SCHEMA
        },
        requiresSecretMapping: {type: 'boolean'},
        mappingKeys: {type: 'array', items: {type: 'string'}}
    }
};

export const NOTIFICATION_BUNDLE_PLAN_IMPORT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['dryRun', 'bundle', 'operations', 'warnings', 'conflicts'],
    properties: {
        dryRun: {type: 'boolean', const: true},
        bundle: NOTIFICATION_BUNDLE_OBJECT_SCHEMA,
        operations: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_IMPORT_OPERATION_SCHEMA
        },
        warnings: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_WARNING_SCHEMA
        },
        conflicts: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_WARNING_SCHEMA
        }
    }
};

export const NOTIFICATION_BUNDLE_APPLY_IMPORT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'dryRun',
        'bundle',
        'operations',
        'applied',
        'skipped',
        'warnings',
        'conflicts'
    ],
    properties: {
        dryRun: {type: 'boolean', const: false},
        bundle: NOTIFICATION_BUNDLE_OBJECT_SCHEMA,
        operations: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_IMPORT_OPERATION_SCHEMA
        },
        applied: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_IMPORT_OPERATION_SCHEMA
        },
        skipped: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_IMPORT_OPERATION_SCHEMA
        },
        warnings: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_WARNING_SCHEMA
        },
        conflicts: {
            type: 'array',
            items: NOTIFICATION_BUNDLE_WARNING_SCHEMA
        }
    }
};

const NOTIFICATION_CHANNEL_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [
        'email_smtp',
        'generic_webhook',
        'slack_webhook',
        'teams_workflow_webhook',
        'telegram_bot',
        'in_app'
    ]
};

const NOTIFICATION_SEVERITY_FILTERS_SCHEMA: JsonSchema = {
    type: 'array',
    items: {
        type: 'string',
        enum: ['info', 'warning', 'critical']
    },
    uniqueItems: true
};

const NOTIFICATION_PREFERENCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'userId',
        'channelType',
        'severityFilters',
        'quietHours',
        'digestPreference',
        'disabled',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        userId: {type: 'string'},
        channelType: NOTIFICATION_CHANNEL_TYPE_SCHEMA,
        severityFilters: NOTIFICATION_SEVERITY_FILTERS_SCHEMA,
        quietHours: {type: 'object', additionalProperties: true},
        digestPreference: {type: 'object', additionalProperties: true},
        disabled: {type: 'boolean'},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const NOTIFICATION_PREFERENCE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA
    }
};

export const NOTIFICATION_PREFERENCE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: NOTIFICATION_PREFERENCE_SCHEMA}
    }
};

export const NOTIFICATION_PREFERENCE_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'channelType',
        'severityFilters',
        'quietHours',
        'digestPreference',
        'disabled'
    ],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        channelType: NOTIFICATION_CHANNEL_TYPE_SCHEMA,
        severityFilters: NOTIFICATION_SEVERITY_FILTERS_SCHEMA,
        quietHours: {type: 'object', additionalProperties: true},
        digestPreference: {type: 'object', additionalProperties: true},
        disabled: {type: 'boolean'}
    }
};

const NOTIFICATION_ON_CALL_ID_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1
};

const NOTIFICATION_ON_CALL_ARRAY_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'object', additionalProperties: true}
};

const NOTIFICATION_ON_CALL_TARGET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true
};

export const NOTIFICATION_ON_CALL_SCHEDULE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'name',
        'timezone',
        'rotationRules',
        'overrides',
        'target',
        'enabled',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: NOTIFICATION_ON_CALL_ID_SCHEMA,
        organizationId: ORG_ID_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 120},
        timezone: {type: 'string', minLength: 1, maxLength: 80},
        rotationRules: NOTIFICATION_ON_CALL_ARRAY_SCHEMA,
        overrides: NOTIFICATION_ON_CALL_ARRAY_SCHEMA,
        target: NOTIFICATION_ON_CALL_TARGET_SCHEMA,
        enabled: {type: 'boolean'},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const NOTIFICATION_ON_CALL_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        enabledOnly: {type: 'boolean', default: false}
    }
};

export const NOTIFICATION_ON_CALL_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: NOTIFICATION_ON_CALL_SCHEDULE_SCHEMA}
    }
};

export const NOTIFICATION_ON_CALL_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'timezone', 'rotationRules', 'overrides', 'target'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        scheduleId: NOTIFICATION_ON_CALL_ID_SCHEMA,
        name: {type: 'string', minLength: 1, maxLength: 120},
        timezone: {type: 'string', minLength: 1, maxLength: 80},
        rotationRules: NOTIFICATION_ON_CALL_ARRAY_SCHEMA,
        overrides: NOTIFICATION_ON_CALL_ARRAY_SCHEMA,
        target: NOTIFICATION_ON_CALL_TARGET_SCHEMA,
        enabled: {type: 'boolean', default: true}
    }
};

export const NOTIFICATION_ON_CALL_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['scheduleId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        scheduleId: NOTIFICATION_ON_CALL_ID_SCHEMA
    }
};

export const NOTIFICATION_ON_CALL_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {
        deleted: {type: 'boolean'}
    }
};

export const NOTIFICATION_ON_CALL_RESOLVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['scheduleId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        scheduleId: NOTIFICATION_ON_CALL_ID_SCHEMA,
        at: {type: 'string'}
    }
};

export const NOTIFICATION_ON_CALL_RESOLVE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['scheduleId', 'userIds', 'source'],
    properties: {
        scheduleId: {type: 'string'},
        userIds: {type: 'array', items: {type: 'string'}},
        source: {
            type: 'string',
            enum: ['override', 'rotation', 'target', 'empty']
        }
    }
};

const NOTIFICATION_ROUTING_POLICY_ID_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1
};

const NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'object', additionalProperties: true}
};

const NOTIFICATION_ROUTING_STRING_ARRAY_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'string', minLength: 1, maxLength: 120}
};

export const NOTIFICATION_ROUTING_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'parentPolicyId',
        'name',
        'sortOrder',
        'labelMatchers',
        'severityMatchers',
        'resourceSelectors',
        'contactPoints',
        'groupingKeys',
        'muteWindows',
        'runtimeSilences',
        'inhibitionRules',
        'escalationStages',
        'enabled',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: NOTIFICATION_ROUTING_POLICY_ID_SCHEMA,
        organizationId: ORG_ID_SCHEMA,
        parentPolicyId: {
            type: ['integer', 'null'],
            minimum: 1
        },
        name: {type: 'string', minLength: 1, maxLength: 120},
        sortOrder: {type: 'integer', minimum: 0},
        labelMatchers: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        severityMatchers: NOTIFICATION_SEVERITY_FILTERS_SCHEMA,
        resourceSelectors: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        contactPoints: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        groupingKeys: NOTIFICATION_ROUTING_STRING_ARRAY_SCHEMA,
        muteWindows: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        runtimeSilences: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        inhibitionRules: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        escalationStages: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        enabled: {type: 'boolean'},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const NOTIFICATION_ROUTING_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        enabledOnly: {type: 'boolean', default: false}
    }
};

export const NOTIFICATION_ROUTING_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: NOTIFICATION_ROUTING_POLICY_SCHEMA}
    }
};

export const NOTIFICATION_ROUTING_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'name',
        'labelMatchers',
        'severityMatchers',
        'resourceSelectors',
        'contactPoints',
        'groupingKeys',
        'muteWindows',
        'runtimeSilences',
        'inhibitionRules',
        'escalationStages'
    ],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policyId: NOTIFICATION_ROUTING_POLICY_ID_SCHEMA,
        parentPolicyId: {
            type: ['integer', 'null'],
            minimum: 1
        },
        name: {type: 'string', minLength: 1, maxLength: 120},
        sortOrder: {type: 'integer', minimum: 0, default: 0},
        labelMatchers: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        severityMatchers: NOTIFICATION_SEVERITY_FILTERS_SCHEMA,
        resourceSelectors: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        contactPoints: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        groupingKeys: NOTIFICATION_ROUTING_STRING_ARRAY_SCHEMA,
        muteWindows: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        runtimeSilences: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        inhibitionRules: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        escalationStages: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        enabled: {type: 'boolean', default: true}
    }
};

export const NOTIFICATION_ROUTING_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policyId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policyId: NOTIFICATION_ROUTING_POLICY_ID_SCHEMA
    }
};

export const NOTIFICATION_ROUTING_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {
        deleted: {type: 'boolean'}
    }
};

export const NOTIFICATION_ROUTING_EVALUATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'labels'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        severity: {type: 'string', enum: ['info', 'warning', 'critical']},
        labels: {
            type: 'object',
            additionalProperties: {type: 'string'}
        },
        resource: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'id'],
            properties: {
                type: {type: 'string', minLength: 1, maxLength: 64},
                id: {type: 'string', minLength: 1, maxLength: 255}
            }
        }
    }
};

const NOTIFICATION_ROUTING_EVALUATE_MATCH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'policyId',
        'name',
        'contactPoints',
        'groupingKeys',
        'escalationStages'
    ],
    properties: {
        policyId: NOTIFICATION_ROUTING_POLICY_ID_SCHEMA,
        name: {type: 'string'},
        contactPoints: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA,
        groupingKeys: NOTIFICATION_ROUTING_STRING_ARRAY_SCHEMA,
        escalationStages: NOTIFICATION_ROUTING_OBJECT_ARRAY_SCHEMA
    }
};

export const NOTIFICATION_ROUTING_EVALUATE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['matches'],
    properties: {
        matches: {
            type: 'array',
            items: NOTIFICATION_ROUTING_EVALUATE_MATCH_SCHEMA
        }
    }
};

export const NOTIFICATION_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'notification',
    {
        kind: 'fleet-manager',
        description:
            'Manage push tokens, inbox state, destination groups, channels, and delivery history.'
    }
)
    .registerMethod('Subscribe', {
        params: NOTIFICATION_SUBSCRIBE_PARAMS_SCHEMA,
        response: NOTIFICATION_SUBSCRIBE_RESPONSE_SCHEMA,
        permission: {
            note: "authenticated — token is bound to the caller's user id at insert time"
        },
        description:
            'Register a push-notification token for the caller. Idempotent per (token, user_id).'
    })
    .registerMethod('ListTokens', {
        params: NOTIFICATION_LIST_TOKENS_PARAMS_SCHEMA,
        response: NOTIFICATION_LIST_TOKENS_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — enumerates push tokens across every tenant'
        },
        description: 'List every push-notification token across every user.'
    })
    .registerMethod('Inbox.List', {
        params: NOTIFICATION_INBOX_LIST_PARAMS_SCHEMA,
        response: NOTIFICATION_INBOX_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'List inbox items for the authenticated caller.'
    })
    .registerMethod('Inbox.Get', {
        params: NOTIFICATION_INBOX_GET_PARAMS_SCHEMA,
        response: NOTIFICATION_INBOX_ITEM_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'Return one inbox item for the authenticated caller.'
    })
    .registerMethod('Inbox.MarkRead', {
        params: NOTIFICATION_INBOX_MARK_READ_PARAMS_SCHEMA,
        response: NOTIFICATION_INBOX_ITEM_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description: 'Mark one inbox item as read.'
    })
    .registerMethod('Inbox.MarkUnread', {
        params: NOTIFICATION_INBOX_MARK_UNREAD_PARAMS_SCHEMA,
        response: NOTIFICATION_INBOX_ITEM_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description: 'Mark one inbox item as unread.'
    })
    .registerMethod('Inbox.MarkAllRead', {
        params: NOTIFICATION_INBOX_MARK_ALL_READ_PARAMS_SCHEMA,
        response: NOTIFICATION_INBOX_UPDATED_COUNT_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description: 'Mark every unread inbox item as read for the caller.'
    })
    .registerMethod('Destination.GetModel', {
        params: DESTINATION_GET_MODEL_PARAMS_SCHEMA,
        response: DESTINATION_MODEL_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Static capability descriptor for the destination-group editor. Phase-1 lock — no nested groups, teams, or escalation.'
    })
    .registerMethod('Destination.List', {
        params: DESTINATION_LIST_PARAMS_SCHEMA,
        response: DESTINATION_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'List destination groups in the caller org.'
    })
    .registerMethod('Destination.Get', {
        params: DESTINATION_GET_PARAMS_SCHEMA,
        response: DESTINATION_GROUP_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'Fetch one destination group.'
    })
    .registerMethod('Destination.Create', {
        params: DESTINATION_CREATE_PARAMS_SCHEMA,
        response: DESTINATION_GROUP_SCHEMA,
        permission: {component: 'notifications', operation: 'create'},
        description: 'Create a destination group.'
    })
    .registerMethod('Destination.Update', {
        params: DESTINATION_UPDATE_PARAMS_SCHEMA,
        response: DESTINATION_GROUP_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description: 'Patch-update a destination group.'
    })
    .registerMethod('Destination.Delete', {
        params: DESTINATION_DELETE_PARAMS_SCHEMA,
        response: DELETED_SCHEMA,
        permission: {component: 'notifications', operation: 'delete'},
        description:
            'Delete a destination group. Rejected while any alert rule still references it.'
    })
    .registerMethod('Destination.ListMembers', {
        params: DESTINATION_LIST_MEMBERS_PARAMS_SCHEMA,
        response: DESTINATION_MEMBER_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'List members of a destination group.'
    })
    .registerMethod('Destination.AddMembers', {
        params: DESTINATION_ADD_MEMBERS_PARAMS_SCHEMA,
        response: DESTINATION_ADD_MEMBERS_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Add members to a destination group. Idempotent on duplicates.'
    })
    .registerMethod('Destination.RemoveMembers', {
        params: DESTINATION_REMOVE_MEMBERS_PARAMS_SCHEMA,
        response: DESTINATION_REMOVE_MEMBERS_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description: 'Remove members from a destination group.'
    })
    .registerMethod('History.List', {
        params: NOTIFICATION_HISTORY_LIST_PARAMS_SCHEMA,
        response: NOTIFICATION_HISTORY_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'List delivery jobs. Filter by channel, state, provider, alert, and time window.'
    })
    .registerMethod('History.Get', {
        params: NOTIFICATION_HISTORY_GET_PARAMS_SCHEMA,
        response: NOTIFICATION_HISTORY_GET_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Fetch one delivery job with its attempt history (newest first).'
    })
    .registerMethod('History.Requeue', {
        params: NOTIFICATION_HISTORY_REQUEUE_PARAMS_SCHEMA,
        response: DELIVERY_JOB_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Re-enqueue a terminally-failed delivery job. Rejected unless state=failed/dead_letter and the backing alert still exists.'
    })
    .registerMethod('RenderTemplate', {
        params: NOTIFICATION_RENDER_TEMPLATE_PARAMS_SCHEMA,
        response: NOTIFICATION_RENDER_TEMPLATE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Render a notification template against a real alert (sampleAlertId) or a synthesized sample for a rule kind. Uses the same renderer as delivery.'
    })
    .registerMethod('RenderEmailPreview', {
        params: NOTIFICATION_RENDER_EMAIL_PREVIEW_PARAMS_SCHEMA,
        response: NOTIFICATION_RENDER_EMAIL_PREVIEW_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Render the full email body (html + text) for an email channel. Uses the configured htmlTemplate/textTemplate overrides if given, otherwise the branded default. The html is safe to iframe.'
    })
    .registerMethod('Bundle.Validate', {
        params: NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_DRY_RUN_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Validate a Fleet Manager notification bundle. Secrets are rejected by default; no data is written.'
    })
    .registerMethod('Bundle.PlanImport', {
        params: NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_PLAN_IMPORT_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Validate a Fleet Manager notification bundle and return create/update/unsupported operations. No data is written.'
    })
    .registerMethod('Bundle.ApplyImport', {
        params: NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_APPLY_IMPORT_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Apply safe notification bundle resources. Routing policies and on-call schedules are written; secret-bearing channels are skipped until secret mapping is supplied.'
    })
    .registerMethod('Bundle.Export', {
        params: NOTIFICATION_BUNDLE_EXPORT_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_DRY_RUN_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Export the native FM notification bundle for the caller org. Secrets are never exported.'
    })
    .registerMethod('Bundle.ImportGrafana', {
        params: NOTIFICATION_BUNDLE_IMPORT_EXTERNAL_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_DRY_RUN_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Convert Grafana provisioning JSON into an FM notification bundle candidate. Dry-run only; secrets are omitted with warnings.'
    })
    .registerMethod('Bundle.ImportAlertmanager', {
        params: NOTIFICATION_BUNDLE_IMPORT_EXTERNAL_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_DRY_RUN_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Convert Prometheus Alertmanager JSON-style config into an FM notification bundle candidate. Dry-run only; secrets are omitted with warnings.'
    })
    .registerMethod('Bundle.ExportGrafana', {
        params: NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_EXPORT_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Convert an FM notification bundle into Grafana provisioning JSON. Dry-run only; secrets are never exported.'
    })
    .registerMethod('Bundle.ExportAlertmanager', {
        params: NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA,
        response: NOTIFICATION_BUNDLE_EXPORT_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Convert an FM notification bundle into Prometheus Alertmanager JSON-style config. Dry-run only; secrets are never exported.'
    })
    .registerMethod('Preference.List', {
        params: NOTIFICATION_PREFERENCE_LIST_PARAMS_SCHEMA,
        response: NOTIFICATION_PREFERENCE_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'List notification preferences for the authenticated user in the caller org.'
    })
    .registerMethod('Preference.Set', {
        params: NOTIFICATION_PREFERENCE_SET_PARAMS_SCHEMA,
        response: NOTIFICATION_PREFERENCE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Set one notification channel preference for the authenticated user.'
    })
    .registerMethod('OnCall.List', {
        params: NOTIFICATION_ON_CALL_LIST_PARAMS_SCHEMA,
        response: NOTIFICATION_ON_CALL_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'List on-call schedules for the caller organization.'
    })
    .registerMethod('OnCall.Set', {
        params: NOTIFICATION_ON_CALL_SET_PARAMS_SCHEMA,
        response: NOTIFICATION_ON_CALL_SCHEDULE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Create or update one organization-scoped on-call schedule.'
    })
    .registerMethod('OnCall.Delete', {
        params: NOTIFICATION_ON_CALL_DELETE_PARAMS_SCHEMA,
        response: NOTIFICATION_ON_CALL_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'delete'},
        description: 'Delete one organization-scoped on-call schedule.'
    })
    .registerMethod('OnCall.Resolve', {
        params: NOTIFICATION_ON_CALL_RESOLVE_PARAMS_SCHEMA,
        response: NOTIFICATION_ON_CALL_RESOLVE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Resolve the active on-call users for one schedule at a specific time.'
    })
    .registerMethod('Routing.List', {
        params: NOTIFICATION_ROUTING_LIST_PARAMS_SCHEMA,
        response: NOTIFICATION_ROUTING_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'List notification routing policies for the caller org.'
    })
    .registerMethod('Routing.Set', {
        params: NOTIFICATION_ROUTING_SET_PARAMS_SCHEMA,
        response: NOTIFICATION_ROUTING_POLICY_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Create or update one notification routing policy for the caller org.'
    })
    .registerMethod('Routing.Delete', {
        params: NOTIFICATION_ROUTING_DELETE_PARAMS_SCHEMA,
        response: NOTIFICATION_ROUTING_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'delete'},
        description: 'Delete one notification routing policy.'
    })
    .registerMethod('Routing.Evaluate', {
        params: NOTIFICATION_ROUTING_EVALUATE_PARAMS_SCHEMA,
        response: NOTIFICATION_ROUTING_EVALUATE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Dry-run routing policies against alert labels, severity, and optional resource.'
    })
    .registerMethod('EmailTemplate.List', {
        params: NOTIFICATION_EMAIL_TEMPLATE_LIST_PARAMS_SCHEMA,
        response: NOTIFICATION_EMAIL_TEMPLATE_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'List saved email templates for this organization.'
    })
    .registerMethod('EmailTemplate.Get', {
        params: NOTIFICATION_EMAIL_TEMPLATE_GET_PARAMS_SCHEMA,
        response: EMAIL_TEMPLATE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'Return one saved email template.'
    })
    .registerMethod('EmailTemplate.Create', {
        params: NOTIFICATION_EMAIL_TEMPLATE_CREATE_PARAMS_SCHEMA,
        response: EMAIL_TEMPLATE_SCHEMA,
        permission: {component: 'notifications', operation: 'create'},
        description:
            'Save a named email template (subject/html/text). Any email_smtp endpoint can reference it via config.emailTemplateId.'
    })
    .registerMethod('EmailTemplate.Update', {
        params: NOTIFICATION_EMAIL_TEMPLATE_UPDATE_PARAMS_SCHEMA,
        response: EMAIL_TEMPLATE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Patch a saved email template. Pass null for any body field to clear it.'
    })
    .registerMethod('EmailTemplate.Delete', {
        params: NOTIFICATION_EMAIL_TEMPLATE_DELETE_PARAMS_SCHEMA,
        response: NOTIFICATION_EMAIL_TEMPLATE_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'delete'},
        description: 'Delete a saved email template by id.'
    })
    .registerMethod('Template.List', {
        params: MESSAGE_TEMPLATE_LIST_PARAMS_SCHEMA,
        response: MESSAGE_TEMPLATE_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'List reusable multi-channel message templates in the caller organization. A rule or an endpoint can point at one.'
    })
    .registerMethod('Template.Get', {
        params: MESSAGE_TEMPLATE_GET_PARAMS_SCHEMA,
        response: MESSAGE_TEMPLATE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'Fetch one message template by id.'
    })
    .registerMethod('Template.Create', {
        params: MESSAGE_TEMPLATE_CREATE_PARAMS_SCHEMA,
        response: MESSAGE_TEMPLATE_SCHEMA,
        permission: {component: 'notifications', operation: 'create'},
        description:
            'Create a message template (per-channel bodies + required fallback text). Slack/Teams bodies must be valid JSON. Preview a body with Notification.RenderTemplate.'
    })
    .registerMethod('Template.Update', {
        params: MESSAGE_TEMPLATE_UPDATE_PARAMS_SCHEMA,
        response: MESSAGE_TEMPLATE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description: 'Update a message template.'
    })
    .registerMethod('Template.Delete', {
        params: MESSAGE_TEMPLATE_DELETE_PARAMS_SCHEMA,
        response: MESSAGE_TEMPLATE_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'delete'},
        description:
            'Delete a message template. Blocked while any rule or endpoint still references it.'
    })
    .registerMethod('EmailAsset.List', {
        params: NOTIFICATION_EMAIL_ASSET_LIST_PARAMS_SCHEMA,
        response: NOTIFICATION_EMAIL_ASSET_LIST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'List uploaded email assets (binary images) for the caller org. Bytes are not returned — fetch via GET /api/notifications/email-assets/:id.'
    })
    .registerMethod('EmailAsset.CreateUploadTicket', {
        params: EMPTY_PARAMS_SCHEMA,
        response: UPLOAD_TICKET_RESPONSE_SCHEMA,
        permission: {note: 'notifications:create or notifications:update'},
        description:
            'Mint a short-lived ticket for POST /api/notifications/email-assets.'
    })
    .registerMethod('EmailAsset.Get', {
        params: NOTIFICATION_EMAIL_ASSET_GET_PARAMS_SCHEMA,
        response: EMAIL_ASSET_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'Return metadata for a single email asset by id.'
    })
    .registerMethod('EmailAsset.Delete', {
        params: NOTIFICATION_EMAIL_ASSET_DELETE_PARAMS_SCHEMA,
        response: NOTIFICATION_EMAIL_ASSET_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'delete'},
        description:
            'Delete an email asset. Templates / endpoints still referencing the assetId will fail to send; audit before deleting.'
    })
    .registerMethod('OAuth.Start', {
        params: NOTIFICATION_OAUTH_START_PARAMS_SCHEMA,
        response: NOTIFICATION_OAUTH_START_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Begin in-app OAuth2 consent for an email_smtp endpoint. Returns an authUrl the UI opens in a popup; the provider redirects to /api/oauth/callback/email which stores the refresh token on the endpoint.'
    })
    .build();
