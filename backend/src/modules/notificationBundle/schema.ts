import {ValidationError, validateParams} from '../../rpc/validation';
import type {JsonSchema} from '../../types/api/_schema';

export const NOTIFICATION_BUNDLE_VERSION = 1;

const SECRET_KEY_PATTERN =
    /(^|\.)(pass|password|token|secret|clientSecret|refreshToken|privateKey|signingSecret|botToken|url)$/i;

const JSON_OBJECT: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    maxBytes: 64 * 1024
};

const STRING_ID: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 255
};

const NAME: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120
};

const CHANNEL_TYPE: JsonSchema = {
    type: 'string',
    enum: [
        'email_smtp',
        'generic_webhook',
        'slack_webhook',
        'teams_workflow_webhook',
        'telegram_bot'
    ]
};

const SEVERITY: JsonSchema = {
    type: 'string',
    enum: ['info', 'warning', 'critical']
};

const CHANNEL_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'type', 'config'],
    properties: {
        id: STRING_ID,
        name: NAME,
        type: CHANNEL_TYPE,
        mode: {
            type: 'string',
            enum: ['use_system_smtp', 'custom_smtp']
        },
        config: JSON_OBJECT
    }
};

const ROUTING_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name'],
    properties: {
        id: STRING_ID,
        parentId: {...STRING_ID, type: ['string', 'null']},
        name: NAME,
        labelMatchers: {type: 'array', items: JSON_OBJECT},
        severityMatchers: {type: 'array', items: SEVERITY},
        resourceSelectors: {type: 'array', items: JSON_OBJECT},
        contactPointIds: {type: 'array', items: STRING_ID},
        groupingKeys: {type: 'array', items: STRING_ID},
        muteWindows: {type: 'array', items: JSON_OBJECT},
        silences: {type: 'array', items: JSON_OBJECT},
        inhibitionRules: {type: 'array', items: JSON_OBJECT},
        escalationStages: {type: 'array', items: JSON_OBJECT}
    }
};

const USER_PREFERENCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['userId', 'channelType'],
    properties: {
        userId: STRING_ID,
        channelType: {
            type: 'string',
            enum: [
                'email_smtp',
                'generic_webhook',
                'slack_webhook',
                'teams_workflow_webhook',
                'telegram_bot',
                'in_app'
            ]
        },
        severityFilters: {type: 'array', items: SEVERITY},
        quietHours: JSON_OBJECT,
        digestPreference: JSON_OBJECT,
        disabled: {type: 'boolean'}
    }
};

const ON_CALL_SCHEDULE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'timezone', 'rotationRules'],
    properties: {
        id: STRING_ID,
        name: NAME,
        timezone: {type: 'string', minLength: 1, maxLength: 80},
        rotationRules: {type: 'array', items: JSON_OBJECT},
        overrides: {type: 'array', items: JSON_OBJECT},
        target: JSON_OBJECT
    }
};

const TEMPLATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    required: ['id', 'name'],
    properties: {
        id: STRING_ID,
        name: NAME
    }
};

export const NOTIFICATION_BUNDLE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['schema', 'version'],
    properties: {
        schema: {type: 'string', const: 'fm.notification.bundle'},
        version: {type: 'integer', const: NOTIFICATION_BUNDLE_VERSION},
        exportedAt: {type: 'string', minLength: 1, maxLength: 64},
        channels: {type: 'array', items: CHANNEL_SCHEMA},
        routingPolicies: {type: 'array', items: ROUTING_POLICY_SCHEMA},
        userPreferences: {type: 'array', items: USER_PREFERENCE_SCHEMA},
        onCallSchedules: {type: 'array', items: ON_CALL_SCHEDULE_SCHEMA},
        templates: {type: 'array', items: TEMPLATE_SCHEMA}
    }
};

export interface NotificationBundle {
    schema: 'fm.notification.bundle';
    version: 1;
    exportedAt?: string;
    channels?: unknown[];
    routingPolicies?: unknown[];
    userPreferences?: unknown[];
    onCallSchedules?: unknown[];
    templates?: unknown[];
}

export function validateNotificationBundle(value: unknown): NotificationBundle {
    const bundle = validateParams<NotificationBundle>(
        value,
        NOTIFICATION_BUNDLE_SCHEMA
    );
    rejectSecrets(bundle);
    return bundle;
}

function rejectSecrets(value: unknown): void {
    const paths = findSecretPaths(value);
    if (paths.length === 0) return;
    throw new ValidationError(
        paths.map((path) => ({
            field: path,
            error: 'secrets are not allowed in notification bundles',
            code: 'additional_property'
        }))
    );
}

function findSecretPaths(value: unknown, path = ''): string[] {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return findArraySecretPaths(value, path);
    return findObjectSecretPaths(value as Record<string, unknown>, path);
}

function findArraySecretPaths(values: unknown[], path: string): string[] {
    return values.flatMap((item, index) =>
        findSecretPaths(item, `${path}[${index}]`)
    );
}

function findObjectSecretPaths(
    record: Record<string, unknown>,
    path: string
): string[] {
    return Object.entries(record).flatMap(([key, nested]) => {
        const nestedPath = path ? `${path}.${key}` : key;
        const direct = SECRET_KEY_PATTERN.test(nestedPath) ? [nestedPath] : [];
        return [...direct, ...findSecretPaths(nested, nestedPath)];
    });
}
