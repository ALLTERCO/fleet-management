// Per-provider static configuration for EditChannelModal.
// Adding a new integration provider here is one row per table — the modal
// stays agnostic of provider-specific shape.

import type {ChannelProvider} from '@api/channel';
import type {TemplateField} from '@/components/core/IntegrationTemplateEditor.vue';

// Tiles that render in the primary row of the picker. Anything not in this
// list still renders, just after the primary set (the visual split between
// Primary and Advanced was retired — all providers are equal tiles now,
// this list is only the explicit ordering preference).
export const PRIMARY_PROVIDERS: ChannelProvider[] = [
    'email_smtp',
    'slack_webhook',
    'teams_workflow_webhook',
    'telegram_bot'
];

// Tagline shown under the brand icon in the picker tile.
export const TILE_META: Partial<
    Record<ChannelProvider, {tagline: string}>
> = {
    email_smtp: {tagline: 'SMTP, OAuth2, branded HTML.'},
    slack_webhook: {tagline: 'Post to a channel via incoming webhook.'},
    teams_workflow_webhook: {tagline: 'Adaptive card to a workflow endpoint.'},
    telegram_bot: {tagline: 'Message via a Telegram bot + chat id.'},
    generic_webhook: {
        tagline: 'Send raw JSON to any HTTP endpoint you control.'
    }
};

// Template-editor fields per provider. The modal renders these via
// IntegrationTemplateEditor; SchemaForm strips them from the connection
// schema to avoid duplicate editors for the same value.
export const TEMPLATE_FIELDS_BY_PROVIDER: Partial<
    Record<ChannelProvider, TemplateField[]>
> = {
    email_smtp: [
        {
            key: 'subjectTemplate',
            label: 'Subject',
            mode: 'plain',
            placeholder: '[{{alert.severity | upper}}] {{rule.name}}',
            hint: 'Single-line subject. Supports tokens.'
        },
        {
            key: 'htmlTemplate',
            label: 'HTML',
            mode: 'html',
            placeholder: '<p>{{alert.title}}</p>',
            hint: 'HTML body — leave empty to use the default branded template.'
        },
        {
            key: 'textTemplate',
            label: 'Plain text',
            mode: 'plain',
            placeholder: '{{alert.title}}',
            hint: 'Plain-text fallback for clients that block HTML.'
        }
    ],
    generic_webhook: [
        {
            key: 'bodyTemplate',
            label: 'Request body',
            mode: 'json',
            placeholder: '{\n  "title": "{{alert.title}}"\n}',
            hint: 'JSON body. Leave empty for the default payload.'
        }
    ],
    slack_webhook: [
        {
            key: 'blocksTemplate',
            label: 'Blocks JSON',
            mode: 'json',
            placeholder: '{\n  "blocks": [ ... ]\n}',
            hint: 'Slack Block Kit JSON. Must produce a valid {blocks: [...]} payload.'
        }
    ],
    teams_workflow_webhook: [
        {
            key: 'cardTemplate',
            label: 'Adaptive card JSON',
            mode: 'json',
            placeholder: '{\n  "type": "AdaptiveCard", "body": [ ... ]\n}',
            hint: 'Adaptive Card JSON for Teams Workflow webhook.'
        }
    ],
    telegram_bot: [
        {
            key: 'messageTemplate',
            label: 'Message',
            mode: 'plain',
            placeholder: '🚨 *{{alert.title}}*',
            hint: 'Format follows the endpoint parseMode (plain / MarkdownV2 / HTML).'
        }
    ]
};

// Content-section header copy per provider. The single source for the
// modal's title + description.
export interface ProviderContentMeta {
    title: string;
    description: string;
}

export const PROVIDER_CONTENT_META: Partial<
    Record<ChannelProvider, ProviderContentMeta>
> = {
    slack_webhook: {
        title: 'Slack blocks',
        description:
            'Block Kit JSON sent to the incoming webhook. Preview updates as you type.'
    },
    teams_workflow_webhook: {
        title: 'Adaptive card',
        description: 'Adaptive Card JSON for the Teams workflow endpoint.'
    },
    telegram_bot: {
        title: 'Message',
        description:
            'Markdown supported. Variables like {{alert.title}} interpolate at delivery.'
    }
};

// Default copy when the provider is unknown or has no specific override.
export const DEFAULT_CONTENT_META: ProviderContentMeta = {
    title: 'Request body',
    description: 'JSON request body. Leave empty to use the default payload.'
};

// Answer — content-section title + description for a provider, with
// fallback when no specific override exists.
export function contentMetaFor(
    provider: ChannelProvider | null
): ProviderContentMeta {
    if (!provider) return DEFAULT_CONTENT_META;
    return PROVIDER_CONTENT_META[provider] ?? DEFAULT_CONTENT_META;
}

// Telegram parse-mode→editor mode map. Adding a new mode is one entry.
const TELEGRAM_PARSE_MODE_EDITOR: Record<string, TemplateField['mode']> = {
    MarkdownV2: 'markdown',
    HTML: 'html'
};

// Telegram parse-mode→hint text map. Same shape so adding a new mode is
// two paired entries.
const TELEGRAM_PARSE_MODE_HINT: Record<string, string> = {
    MarkdownV2:
        'MarkdownV2 — escape \\ _ * [ ] ( ) ~ ` > # + - = | { } . ! with a backslash outside code.',
    HTML: 'Telegram HTML subset — <b> <i> <u> <s> <a> <code> <pre> <br> only.'
};

const TELEGRAM_DEFAULT_HINT =
    'Plain text. Set parseMode on the Connection tab to enable MarkdownV2 or HTML.';

// Answer — editor mode for the Telegram message template based on the
// configured parseMode.
export function telegramEditorMode(parseMode: unknown): TemplateField['mode'] {
    if (typeof parseMode !== 'string') return 'plain';
    return TELEGRAM_PARSE_MODE_EDITOR[parseMode] ?? 'plain';
}

// Answer — hint text for the Telegram message template based on the
// configured parseMode.
export function telegramHintFor(parseMode: unknown): string {
    if (typeof parseMode !== 'string') return TELEGRAM_DEFAULT_HINT;
    return TELEGRAM_PARSE_MODE_HINT[parseMode] ?? TELEGRAM_DEFAULT_HINT;
}
