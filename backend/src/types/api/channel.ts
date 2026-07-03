/** Public API types for the `channel.*` namespace. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {EMAIL_ATTACHMENTS_SCHEMA, NAME_SCHEMA, ORG_ID_SCHEMA} from './_shared';
import {SMTP_PRESET_KEYS, SMTP_PRESETS, type SmtpPreset} from './smtpPresets';

// Single source of truth for providers. The matching Postgres CHECK on
// notifications.channels (migration 6910) is pinned to this set by
// integrationProviderCheckSync.test.ts — add a provider here and there.
export const CHANNEL_PROVIDERS = [
    'email_smtp',
    'generic_webhook',
    'slack_webhook',
    'teams_workflow_webhook',
    'telegram_bot',
    'push_fcm',
    'sms_twilio',
    'voice_twilio',
    'webhook_signed'
] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export interface EmailCaps {
    /** Max attachments per template / channel (FM_EMAIL_MAX_ATTACHMENTS). */
    maxAttachments: number;
    /** Max bytes per attachment — URL or asset (FM_EMAIL_ATTACHMENT_MAX_BYTES). */
    maxAttachmentBytes: number;
    /** true → http:// attachment URLs are accepted in addition to https://. */
    allowHttpAttachments: boolean;
    /** Per-org total-bytes quota for uploaded binary assets. */
    assetOrgQuotaBytes: number;
    /** MIME types accepted by the POST /api/notifications/email-assets route. */
    assetAllowedContentTypes: readonly string[];
}

export interface ChannelProviderDescriptor {
    key: ChannelProvider;
    label: string;
    phaseAvailable: 3 | 4 | 5;
    enabled: boolean;
    configSchema: Record<string, unknown>;
    testSupported: boolean;
    /** Config field names the frontend should render as template editors
     *  (mustache {{alert.*}}/{{rule.*}} tokens). Empty for providers without
     *  per-channel template overrides. */
    templateFields: readonly string[];
    /** email_smtp only — curated provider presets for the UI dropdown.
     *  Single source of truth; frontend must not hardcode a parallel list. */
    smtpPresets?: readonly SmtpPreset[];
    /** email_smtp only — env-backed limits the UI uses to pre-validate
     *  uploads, attachments, and MIME types. Live value (not contract). */
    emailCaps?: EmailCaps;
}

export interface ChannelHealth {
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    autoDisabledAt: string | null;
    disableReason: string | null;
}

export interface ChannelQuietHours {
    /** 0-23 inclusive; window is [start, end), wraps past midnight if start > end. */
    startHour: number;
    endHour: number;
    /** IANA timezone; "UTC" if unspecified at create. */
    timezone: string;
}

export interface Channel {
    id: number;
    organizationId: string;
    provider: ChannelProvider;
    name: string;
    enabled: boolean;
    config: Record<string, unknown>;
    secretState: {
        hasSecretFields: boolean;
    };
    lastTestAt: string | null;
    lastTestStatus: 'success' | 'failed' | null;
    lastDeliveryAt: string | null;
    lastDeliveryStatus: 'success' | 'failed' | null;
    health: ChannelHealth;
    quietHours: ChannelQuietHours | null;
    createdAt: string;
    updatedAt: string | null;
}

export interface ChannelTestResult {
    channelId: number;
    state: 'success' | 'failed';
    testedAt: string;
    errorMessage: string | null;
}

const EMPTY_PARAMS: JsonSchema = {
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

const PROVIDER_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...CHANNEL_PROVIDERS]
};

const ENDPOINT_CONFIG_PATCH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    maxProperties: 100,
    maxBytes: 64 * 1024
};

const URL_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 2000,
    pattern: '^https?://',
    description: 'HTTPS is strongly recommended for outbound integrations.'
};

const EMAIL_SMTP_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'toAddresses'],
    properties: {
        preset: {
            type: 'string',
            enum: [...SMTP_PRESET_KEYS],
            default: 'custom',
            description:
                'Provider preset — auto-fills host/port/secure. "custom" requires explicit host/port.'
        },
        host: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description:
                'SMTP host. Optional when a non-custom preset is set (preset value wins unless overridden here).'
        },
        port: {
            type: 'integer',
            minimum: 1,
            maximum: 65535,
            description: 'Optional override of the preset port.'
        },
        secure: {
            type: 'boolean',
            description:
                'true = implicit TLS (port 465); false = STARTTLS upgrade (587/25). Overrides preset.'
        },
        from: {
            type: 'string',
            minLength: 3,
            maxLength: 320,
            description:
                'Envelope sender address (e.g. alerts@acme.com). Must be allowed by the SMTP relay and your DNS SPF/DKIM records.'
        },
        fromName: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description: 'Optional display name shown in the recipient inbox.'
        },
        toAddresses: {
            type: 'array',
            items: {type: 'string', minLength: 3, maxLength: 320},
            minItems: 1,
            maxItems: 50,
            description:
                'One or more recipient addresses. All receive every alert routed through this channel.'
        },
        ccAddresses: {
            type: 'array',
            items: {type: 'string', minLength: 3, maxLength: 320},
            maxItems: 50,
            description: 'Optional carbon-copy recipients.'
        },
        bccAddresses: {
            type: 'array',
            items: {type: 'string', minLength: 3, maxLength: 320},
            maxItems: 50,
            description: 'Optional blind-copy recipients (invisible to to/cc).'
        },
        replyTo: {
            type: 'string',
            minLength: 3,
            maxLength: 320,
            description:
                'Address replies should go to. Omit to accept replies at `from`.'
        },
        priority: {
            type: 'string',
            enum: ['high', 'normal', 'low'],
            default: 'normal',
            description:
                'Maps to X-Priority / Importance headers (recipient clients may honour this).'
        },
        auth: {
            type: 'object',
            additionalProperties: false,
            properties: {
                type: {
                    type: 'string',
                    enum: ['password', 'oauth2_google', 'oauth2_microsoft'],
                    default: 'password',
                    description:
                        'Authentication mode. "password" = SMTP AUTH (account password or app password). "oauth2_google" / "oauth2_microsoft" = XOAUTH2 — requires clientId/clientSecret/refreshToken from an OAuth app you registered with Google/Microsoft.'
                },
                user: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 255,
                    description:
                        'Mailbox (e.g. alerts@acme.com). Required for every auth type.'
                },
                pass: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2048,
                    description:
                        'Secret — used when type=password. For Gmail/Outlook.com/Yahoo/iCloud use an app password (2FA). Stored encrypted, always redacted on reads.'
                },
                clientId: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 1024,
                    description:
                        'OAuth2 client ID from the Google / Microsoft app registration. Required when type=oauth2_*.'
                },
                clientSecret: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2048,
                    description:
                        'Secret — OAuth2 client secret. Required when type=oauth2_*. Stored encrypted.'
                },
                refreshToken: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                    description:
                        'Secret — long-lived refresh token obtained via the consent flow. Required when type=oauth2_*. Stored encrypted.'
                },
                tenant: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 120,
                    description:
                        'Microsoft 365 tenant id or "common"/"organizations". Only used when type=oauth2_microsoft. Defaults to "common" when unset.'
                }
            }
        },
        tls: {
            type: 'object',
            additionalProperties: false,
            description:
                'TLS policy. Unset keys fall back to FM_SMTP_DEFAULT_TLS_MIN_VERSION / FM_SMTP_DEFAULT_TLS_REJECT_UNAUTHORIZED.',
            properties: {
                minVersion: {
                    type: 'string',
                    enum: ['TLSv1.2', 'TLSv1.3']
                },
                rejectUnauthorized: {
                    type: 'boolean',
                    description:
                        'Reject self-signed / untrusted certificates. Disable ONLY for pinned internal relays.'
                }
            }
        },
        connectionTimeoutMs: {
            type: 'integer',
            minimum: 1000,
            maximum: 300000,
            description:
                'Per-connection establish timeout. Default from FM_SMTP_CONNECTION_TIMEOUT_MS.'
        },
        greetingTimeoutMs: {
            type: 'integer',
            minimum: 1000,
            maximum: 300000,
            description:
                'Wait for the SMTP banner after connect. Default from FM_SMTP_GREETING_TIMEOUT_MS.'
        },
        socketTimeoutMs: {
            type: 'integer',
            minimum: 1000,
            maximum: 300000,
            description:
                'Idle-socket timeout during the SMTP conversation. Default from FM_SMTP_SOCKET_TIMEOUT_MS.'
        },
        templateId: {
            type: 'integer',
            minimum: 1,
            description:
                'Reuse a saved multi-channel template from Notification.Template.*. Its email body is rendered at send time. A rule template, if any, takes precedence.'
        },
        emailTemplateId: {
            type: 'integer',
            minimum: 1,
            description:
                'Reuse a saved template from Notification.EmailTemplate.*. Inline subject/html/text templates below override the saved ones field-by-field.'
        },
        subjectTemplate: {
            type: 'string',
            minLength: 1,
            maxLength: 998,
            description:
                'Optional subject-line template with {{alert.*}}/{{rule.*}} tokens. Single line, no HTML escaping. Empty/missing falls back to the saved template (if any), then alert.title.'
        },
        htmlTemplate: {
            type: 'string',
            minLength: 1,
            maxLength: 32000,
            description:
                'Optional HTML template with {{alert.*}}/{{rule.*}} tokens. Rendered with HTML-safe escaping at send time. Empty/missing uses the branded default.'
        },
        textTemplate: {
            type: 'string',
            minLength: 1,
            maxLength: 8000,
            description:
                'Optional plain-text alternative with {{alert.*}}/{{rule.*}} tokens. Empty/missing uses the default.'
        },
        attachments: {
            ...EMAIL_ATTACHMENTS_SCHEMA,
            description:
                'Optional attachments fetched by URL at send time. Use cid + <img src="cid:id"> for inline images (e.g. branded logos). Endpoint attachments REPLACE those from the saved template — inline wins.'
        },
        dkim: {
            type: 'object',
            additionalProperties: false,
            required: ['domainName', 'keySelector', 'privateKey'],
            description:
                'Optional DKIM signing. Only useful when sending directly via your own MTA — transactional relays (SendGrid/Mailgun/SES/Postmark) sign for you. Requires a DNS TXT record at <selector>._domainkey.<domain>.',
            properties: {
                domainName: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 255,
                    description:
                        'Signing domain — usually matches the `from` address domain.'
                },
                keySelector: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 255,
                    description:
                        'DKIM selector (label on the DNS TXT record, e.g. "fleet2024").'
                },
                privateKey: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 8192,
                    description:
                        'Secret — PEM-encoded RSA or Ed25519 private key. Stored encrypted, always redacted on reads.'
                }
            }
        }
    }
};

// Per-provider rich templates — optional JSON-string bodies with {{token}}
// substitution through the shared renderer. Parse failures at send time
// log a warning and fall back to the default shape.
const TEMPLATE_JSON_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 16000,
    description:
        'Optional JSON template with {{alert.*}}/{{rule.*}} tokens. Rendered with JSON-safe escaping and parsed at send time; invalid JSON falls back to the default payload.'
};

// Headers are stored as an array (name/value pairs) so secret-marked
// rows can be redacted by index in the management UI. Adapter mirrors
// the schema. Adapter always POSTs; the method field is kept for
// backward-compat with stored configs and ignored at send time.
const GENERIC_WEBHOOK_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
        url: URL_SCHEMA,
        method: {
            type: 'string',
            enum: ['POST'],
            default: 'POST'
        },
        signingSecret: {
            type: 'string',
            minLength: 1,
            maxLength: 2048,
            description: 'Optional secret field used to sign outbound payloads.'
        },
        timeoutMs: {
            type: 'integer',
            minimum: 1000,
            maximum: 60_000
        },
        headers: {
            type: 'array',
            maxItems: 30,
            items: {
                type: 'object',
                required: ['name'],
                additionalProperties: false,
                properties: {
                    name: {type: 'string', minLength: 1, maxLength: 200},
                    value: {type: 'string', maxLength: 2048},
                    secret: {type: 'boolean'}
                }
            }
        },
        bodyTemplate: TEMPLATE_JSON_SCHEMA
    }
};

const SLACK_WEBHOOK_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
        url: {
            ...URL_SCHEMA,
            description: 'Slack incoming webhook URL. Secret field.'
        },
        channelOverride: {
            type: 'string',
            maxLength: 120,
            description:
                'Sent as `channel`. Honored only by legacy custom-integration webhooks; app-based webhooks post to their configured channel and ignore this.'
        },
        blocksTemplate: TEMPLATE_JSON_SCHEMA
    }
};

// Per-channel @mention. id = AAD object id (UUID) or UPN; name =
// display text embedded in the TextBlock body. Both fields required —
// Teams renders the @mention only when the entity's `text` exactly
// matches a `<at>name</at>` token in a body TextBlock.
const TEAMS_MENTION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name'],
    properties: {
        id: {
            type: 'string',
            minLength: 1,
            maxLength: 256,
            description:
                'AAD object id (UUID) or user principal name. Paged by Teams when mention fires.'
        },
        name: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            description:
                'Display text wrapped by <at>...</at> in the card body.'
        }
    }
};

// Additional fact rows appended after the default FactSet (Rule / Source / Fired).
const TEAMS_FACT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'value'],
    properties: {
        title: {type: 'string', minLength: 1, maxLength: 120},
        value: {
            type: 'string',
            minLength: 1,
            maxLength: 1000,
            description:
                'Supports {{alert.*}}/{{rule.*}} tokens. HTML-escaped before render.'
        }
    }
};

const TEAMS_WEBHOOK_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
        url: {
            ...URL_SCHEMA,
            description: 'Microsoft Teams workflow/webhook URL. Secret field.'
        },
        cardTemplate: {
            ...TEMPLATE_JSON_SCHEMA,
            description:
                'Optional full Adaptive Card JSON override. When supplied as {body,actions,msteams}, merges over the default envelope instead of replacing it — keeps Fleet chrome (severity header, facts, OpenUrl). Full {attachments:[...]} envelopes are used as-is.'
        },
        headingTemplate: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description:
                'Optional one-line template replacing the default title. Supports {{alert.*}}/{{rule.*}}.'
        },
        footerTemplate: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description:
                'Optional small-text footer appended below the message body. Supports tokens.'
        },
        additionalFacts: {
            type: 'array',
            maxItems: 10,
            items: TEAMS_FACT_SCHEMA,
            description:
                'Extra rows appended to the FactSet in order. Each value is token-rendered.'
        },
        mentions: {
            type: 'array',
            maxItems: 20,
            items: TEAMS_MENTION_SCHEMA,
            description:
                'Users @mentioned by Teams on severities listed in FM_TEAMS_MENTION_SEVERITIES (default: critical). Empty/omitted = no mentions.'
        }
    }
};

const TELEGRAM_BOT_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['botToken', 'chatId'],
    properties: {
        botToken: {
            type: 'string',
            minLength: 1,
            maxLength: 2048,
            description:
                'Bot token from BotFather (format: <id>:<hex>). Secret field — stored encrypted, redacted on reads.'
        },
        chatId: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            pattern: '^(-?\\d+|@[a-zA-Z0-9_]{5,32})$',
            description:
                'Numeric user/chat id (e.g. 123456789), negative group id (e.g. -100xxxxxxxxxx for supergroups/channels), or @public_channel_username.'
        },
        parseMode: {
            type: 'string',
            enum: ['MarkdownV2', 'HTML'],
            description:
                'Optional formatting for messageTemplate output. Omit for plain text. Under MarkdownV2/HTML Fleet auto-escapes interpolated {{alert.*}}/{{rule.*}} tokens so alert content never breaks entity parsing.'
        },
        messageTemplate: {
            type: 'string',
            minLength: 1,
            maxLength: 8000,
            description:
                "Optional template with {{alert.*}}/{{rule.*}} tokens. Empty/missing uses the built-in severity-badge default. Truncated to Telegram's 4096-char limit with ellipsis."
        }
    }
};

const PUSH_FCM_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'platform'],
    properties: {
        token: {
            type: 'string',
            minLength: 1,
            maxLength: 4096,
            description: 'Per-device push token (FCM registration token).'
        },
        platform: {
            type: 'string',
            enum: ['ios', 'android', 'webpush']
        },
        env: {type: 'string', enum: ['prod', 'sandbox'], default: 'prod'}
    }
};

const SMS_TWILIO_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['to'],
    // Sender is either a From (number or alphanumeric id) or a Messaging Service.
    anyOf: [{required: ['from']}, {required: ['messagingServiceSid']}],
    properties: {
        to: {
            type: 'string',
            pattern: '^\\+[1-9]\\d{7,14}$',
            description: 'E.164 recipient number.'
        },
        from: {
            type: 'string',
            pattern: '^(\\+[1-9]\\d{7,14}|[A-Za-z0-9 ]{1,11})$',
            description:
                'Sender: E.164 Twilio number, or an alphanumeric Sender ID (1-11 chars, supported outside US/CA).'
        },
        messagingServiceSid: {
            type: 'string',
            pattern: '^MG[0-9a-fA-F]{32}$',
            description:
                'Twilio Messaging Service SID (sender pool / number selection). Overrides from.'
        },
        statusCallback: {
            type: 'string',
            format: 'uri',
            maxLength: 2048,
            description: 'Optional URL Twilio POSTs delivery status to.'
        }
    }
};

const VOICE_TWILIO_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['to', 'from', 'twimlUrl'],
    properties: {
        to: {type: 'string', pattern: '^\\+[1-9]\\d{7,14}$'},
        from: {type: 'string', pattern: '^\\+[1-9]\\d{7,14}$'},
        twimlUrl: {
            type: 'string',
            format: 'uri',
            maxLength: 2048,
            description: 'Hosted TwiML URL returning <Say>/<Gather> markup.'
        }
    }
};

const WEBHOOK_SIGNED_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'signingSecret'],
    properties: {
        url: URL_SCHEMA,
        signingSecret: {
            type: 'string',
            minLength: 32,
            maxLength: 2048,
            description:
                'HMAC-SHA256 secret. Header: fm-signature: t=...,v1=...'
        },
        timeoutMs: {
            type: 'integer',
            minimum: 1000,
            maximum: 60_000
        },
        headers: {
            type: 'array',
            maxItems: 30,
            items: {
                type: 'object',
                required: ['name'],
                additionalProperties: false,
                properties: {
                    name: {type: 'string', minLength: 1, maxLength: 200},
                    value: {type: 'string', maxLength: 2048},
                    secret: {type: 'boolean'}
                }
            }
        },
        bodyTemplate: TEMPLATE_JSON_SCHEMA
    }
};

export const CHANNEL_PROVIDER_CONFIG_SCHEMAS: Record<
    ChannelProvider,
    JsonSchema
> = {
    email_smtp: EMAIL_SMTP_CONFIG_SCHEMA,
    generic_webhook: GENERIC_WEBHOOK_CONFIG_SCHEMA,
    slack_webhook: SLACK_WEBHOOK_CONFIG_SCHEMA,
    teams_workflow_webhook: TEAMS_WEBHOOK_CONFIG_SCHEMA,
    telegram_bot: TELEGRAM_BOT_CONFIG_SCHEMA,
    push_fcm: PUSH_FCM_CONFIG_SCHEMA,
    sms_twilio: SMS_TWILIO_CONFIG_SCHEMA,
    voice_twilio: VOICE_TWILIO_CONFIG_SCHEMA,
    webhook_signed: WEBHOOK_SIGNED_CONFIG_SCHEMA
};

const EMAIL_CAPS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'maxAttachments',
        'maxAttachmentBytes',
        'allowHttpAttachments',
        'assetOrgQuotaBytes',
        'assetAllowedContentTypes'
    ],
    properties: {
        maxAttachments: {type: 'integer', minimum: 0},
        maxAttachmentBytes: {type: 'integer', minimum: 0},
        allowHttpAttachments: {type: 'boolean'},
        assetOrgQuotaBytes: {type: 'integer', minimum: 0},
        assetAllowedContentTypes: {type: 'array', items: {type: 'string'}}
    }
};

const SMTP_PRESET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'label', 'category', 'host', 'port', 'secure'],
    properties: {
        key: {type: 'string'},
        label: {type: 'string'},
        category: {
            type: 'string',
            enum: [
                'personal',
                'workspace',
                'transactional',
                'regional',
                'custom'
            ]
        },
        host: {type: 'string'},
        port: {type: 'integer', minimum: 1, maximum: 65535},
        secure: {type: 'boolean'},
        appPasswordOnly: {type: 'boolean'},
        oauthRequired: {type: 'boolean'},
        notes: {type: 'string'},
        docsUrl: {type: 'string'}
    }
};

const PROVIDER_DESCRIPTOR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'key',
        'label',
        'phaseAvailable',
        'enabled',
        'configSchema',
        'testSupported',
        'templateFields'
    ],
    properties: {
        key: {type: 'string', enum: [...CHANNEL_PROVIDERS]},
        label: {type: 'string'},
        phaseAvailable: {type: 'integer', enum: [3, 4, 5]},
        enabled: {type: 'boolean'},
        configSchema: {type: 'object'},
        testSupported: {type: 'boolean'},
        templateFields: {type: 'array', items: {type: 'string'}},
        smtpPresets: {type: 'array', items: SMTP_PRESET_SCHEMA},
        emailCaps: EMAIL_CAPS_SCHEMA
    }
};

export const CHANNEL_LIST_PROVIDERS_PARAMS_SCHEMA = EMPTY_PARAMS;
export const CHANNEL_LIST_PROVIDERS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: PROVIDER_DESCRIPTOR_SCHEMA}
    }
};

// Per-provider template field names. Mirrors the *Template properties on
// each config schema — the frontend iterates this list to render template
// editors instead of hardcoding provider→field mappings.
export const CHANNEL_PROVIDER_TEMPLATE_FIELDS: Record<
    ChannelProvider,
    readonly string[]
> = {
    email_smtp: ['subjectTemplate', 'htmlTemplate', 'textTemplate'],
    generic_webhook: ['bodyTemplate'],
    slack_webhook: ['blocksTemplate'],
    teams_workflow_webhook: [
        'cardTemplate',
        'headingTemplate',
        'footerTemplate'
    ],
    telegram_bot: ['messageTemplate'],
    push_fcm: [],
    sms_twilio: [],
    voice_twilio: [],
    webhook_signed: ['bodyTemplate']
};

export const CHANNEL_PROVIDER_DESCRIPTORS: ChannelProviderDescriptor[] = [
    {
        key: 'email_smtp',
        label: 'Email (SMTP)',
        phaseAvailable: 3,
        enabled: true,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.email_smtp,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.email_smtp,
        smtpPresets: SMTP_PRESETS
    },
    {
        key: 'generic_webhook',
        label: 'Generic Webhook',
        phaseAvailable: 3,
        enabled: true,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.generic_webhook,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.generic_webhook
    },
    {
        key: 'slack_webhook',
        label: 'Slack Webhook',
        phaseAvailable: 4,
        enabled: true,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.slack_webhook,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.slack_webhook
    },
    {
        key: 'teams_workflow_webhook',
        label: 'Microsoft Teams Workflow Webhook',
        phaseAvailable: 4,
        enabled: true,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.teams_workflow_webhook,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.teams_workflow_webhook
    },
    {
        key: 'telegram_bot',
        label: 'Telegram Bot',
        phaseAvailable: 5,
        enabled: true,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.telegram_bot,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.telegram_bot
    },
    {
        key: 'push_fcm',
        label: 'Mobile Push (FCM)',
        phaseAvailable: 5,
        enabled: false,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.push_fcm,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.push_fcm
    },
    {
        key: 'sms_twilio',
        label: 'SMS (Twilio)',
        phaseAvailable: 5,
        enabled: false,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.sms_twilio,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.sms_twilio
    },
    {
        key: 'voice_twilio',
        label: 'Voice Call (Twilio)',
        phaseAvailable: 5,
        enabled: false,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.voice_twilio,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.voice_twilio
    },
    {
        key: 'webhook_signed',
        label: 'Signed Webhook',
        phaseAvailable: 5,
        enabled: true,
        configSchema: CHANNEL_PROVIDER_CONFIG_SCHEMAS.webhook_signed,
        testSupported: true,
        templateFields: CHANNEL_PROVIDER_TEMPLATE_FIELDS.webhook_signed
    }
];

const SECRET_STATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['hasSecretFields'],
    properties: {
        hasSecretFields: {type: 'boolean'}
    }
};

const TEST_STATUS_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    enum: ['success', 'failed', null]
};

const ENDPOINT_HEALTH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'consecutiveFailures',
        'lastSuccessAt',
        'lastFailureAt',
        'autoDisabledAt',
        'disableReason'
    ],
    properties: {
        consecutiveFailures: {type: 'integer', minimum: 0},
        lastSuccessAt: {type: ['string', 'null']},
        lastFailureAt: {type: ['string', 'null']},
        autoDisabledAt: {type: ['string', 'null']},
        disableReason: {type: ['string', 'null']}
    }
};

const QUIET_HOURS_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['startHour', 'endHour', 'timezone'],
    properties: {
        startHour: {type: 'integer', minimum: 0, maximum: 23},
        endHour: {type: 'integer', minimum: 0, maximum: 23},
        timezone: {type: 'string', minLength: 1, maxLength: 60}
    }
};

export const CHANNEL_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'provider',
        'name',
        'enabled',
        'config',
        'secretState',
        'lastTestAt',
        'lastTestStatus',
        'lastDeliveryAt',
        'lastDeliveryStatus',
        'health',
        'quietHours',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        provider: PROVIDER_SCHEMA,
        name: NAME_SCHEMA,
        enabled: {type: 'boolean'},
        config: {
            type: 'object',
            additionalProperties: true
        },
        secretState: SECRET_STATE_SCHEMA,
        lastTestAt: {type: ['string', 'null']},
        lastTestStatus: TEST_STATUS_SCHEMA,
        lastDeliveryAt: {type: ['string', 'null']},
        lastDeliveryStatus: TEST_STATUS_SCHEMA,
        health: ENDPOINT_HEALTH_SCHEMA,
        quietHours: QUIET_HOURS_SCHEMA,
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const CHANNEL_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        provider: PROVIDER_SCHEMA,
        enabled: {type: 'boolean'},
        query: QUERY_SCHEMA,
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA
    }
};

export const CHANNEL_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const CHANNEL_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['provider', 'name', 'config'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        provider: PROVIDER_SCHEMA,
        name: NAME_SCHEMA,
        enabled: {type: 'boolean', default: true},
        config: ENDPOINT_CONFIG_PATCH_SCHEMA,
        quietHours: QUIET_HOURS_SCHEMA
    }
};

export const CHANNEL_UPDATE_PARAMS_SCHEMA: JsonSchema = {
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
                enabled: {type: 'boolean'},
                config: ENDPOINT_CONFIG_PATCH_SCHEMA,
                quietHours: QUIET_HOURS_SCHEMA
            }
        }
    }
};

export const CHANNEL_RESET_HEALTH_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        reEnable: {type: 'boolean', default: true}
    }
};

export const CHANNEL_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const CHANNEL_TEST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        dryRun: {type: 'boolean', default: false},
        payload: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 255},
                message: {type: 'string', maxLength: 4000}
            }
        }
    }
};

const LIST_ENVELOPE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: CHANNEL_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
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

export const CHANNEL_TEST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['channelId', 'state', 'testedAt', 'errorMessage'],
    properties: {
        channelId: {type: 'integer'},
        state: {type: 'string', enum: ['success', 'failed']},
        testedAt: {type: 'string'},
        errorMessage: {type: ['string', 'null']}
    }
};

export const CHANNEL_DESCRIBE: DescribeOutput = new DescribeBuilder('channel', {
    kind: 'fleet-manager',
    description: 'Manage outbound notification channels and their providers.'
})
    .registerMethod('ListProviders', {
        params: CHANNEL_LIST_PROVIDERS_PARAMS_SCHEMA,
        response: CHANNEL_LIST_PROVIDERS_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Return backend-driven channel provider descriptors and config schemas.'
    })
    .registerMethod('List', {
        params: CHANNEL_LIST_PARAMS_SCHEMA,
        response: LIST_ENVELOPE_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'List channels in the caller organization.'
    })
    .registerMethod('Get', {
        params: CHANNEL_GET_PARAMS_SCHEMA,
        response: CHANNEL_SCHEMA,
        permission: {component: 'notifications', operation: 'read'},
        description: 'Return one channel.'
    })
    .registerMethod('Create', {
        params: CHANNEL_CREATE_PARAMS_SCHEMA,
        response: CHANNEL_SCHEMA,
        permission: {component: 'notifications', operation: 'create'},
        description:
            'Create a channel. Secret fields are stored separately and encrypted.'
    })
    .registerMethod('Update', {
        params: CHANNEL_UPDATE_PARAMS_SCHEMA,
        response: CHANNEL_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description: 'Update a channel. Omitted secret fields are preserved.'
    })
    .registerMethod('Delete', {
        params: CHANNEL_DELETE_PARAMS_SCHEMA,
        response: DELETED_SCHEMA,
        permission: {component: 'notifications', operation: 'delete'},
        description:
            'Delete a channel if no destination groups still reference it.'
    })
    .registerMethod('Test', {
        params: CHANNEL_TEST_PARAMS_SCHEMA,
        response: CHANNEL_TEST_RESPONSE_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Validate and optionally send a provider-specific test message through the channel.'
    })
    .registerMethod('ResetHealth', {
        params: CHANNEL_RESET_HEALTH_PARAMS_SCHEMA,
        response: CHANNEL_SCHEMA,
        permission: {component: 'notifications', operation: 'update'},
        description:
            'Clear consecutive_failures + auto_disabled_at and (by default) re-enable after an auto-disable.'
    })
    .build();
