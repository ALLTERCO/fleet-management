// Single source of truth for notification channel type metadata.
// Look up a type once, get its label, icon, brand color, and fieldset
// component name — no scattered switch statements anywhere else.

export type ChannelType =
    | 'email_smtp'
    | 'generic_webhook'
    | 'slack_webhook'
    | 'teams_workflow_webhook'
    | 'telegram_bot'
    | 'push_fcm'
    | 'sms_twilio'
    | 'voice_twilio'
    | 'webhook_signed'
    | 'in_app';

export interface ChannelTypeMeta {
    readonly value: ChannelType;
    readonly label: string;
    readonly icon: string;
    readonly colorToken: string;
    readonly fieldsetComponent: string | null;
    readonly testable: boolean;
}

const CHANNEL_TYPE_META: Readonly<Record<ChannelType, ChannelTypeMeta>> = {
    email_smtp: {
        value: 'email_smtp',
        label: 'Email',
        icon: 'fa-solid fa-envelope',
        colorToken: '--channel-color-email',
        fieldsetComponent: 'EmailFieldset',
        testable: true
    },
    generic_webhook: {
        value: 'generic_webhook',
        label: 'Webhook',
        icon: 'fa-solid fa-link',
        colorToken: '--channel-color-webhook',
        fieldsetComponent: 'WebhookFieldset',
        testable: true
    },
    slack_webhook: {
        value: 'slack_webhook',
        label: 'Slack',
        icon: 'fa-brands fa-slack',
        colorToken: '--channel-color-slack',
        fieldsetComponent: 'SlackFieldset',
        testable: true
    },
    teams_workflow_webhook: {
        value: 'teams_workflow_webhook',
        label: 'Teams',
        icon: 'fa-brands fa-microsoft',
        colorToken: '--channel-color-teams',
        fieldsetComponent: 'TeamsFieldset',
        testable: true
    },
    telegram_bot: {
        value: 'telegram_bot',
        label: 'Telegram',
        icon: 'fa-brands fa-telegram',
        colorToken: '--channel-color-telegram',
        fieldsetComponent: 'TelegramFieldset',
        testable: true
    },
    push_fcm: {
        value: 'push_fcm',
        label: 'Push (FCM)',
        icon: 'fa-solid fa-mobile-screen',
        colorToken: '--channel-color-push',
        fieldsetComponent: 'PushFcmFieldset',
        testable: true
    },
    sms_twilio: {
        value: 'sms_twilio',
        label: 'SMS (Twilio)',
        icon: 'fa-solid fa-comment-sms',
        colorToken: '--channel-color-sms',
        fieldsetComponent: 'SmsTwilioFieldset',
        testable: true
    },
    voice_twilio: {
        value: 'voice_twilio',
        label: 'Voice (Twilio)',
        icon: 'fa-solid fa-phone-volume',
        colorToken: '--channel-color-voice',
        fieldsetComponent: 'VoiceTwilioFieldset',
        testable: true
    },
    webhook_signed: {
        value: 'webhook_signed',
        label: 'Signed webhook',
        icon: 'fa-solid fa-shield-halved',
        colorToken: '--channel-color-webhook-signed',
        fieldsetComponent: 'WebhookSignedFieldset',
        testable: true
    },
    in_app: {
        value: 'in_app',
        label: 'In-app',
        icon: 'fa-solid fa-bell',
        colorToken: '--channel-color-inapp',
        fieldsetComponent: null,
        testable: false
    }
};

const CONFIGURABLE_CHANNEL_TYPES: readonly ChannelType[] = [
    'email_smtp',
    'slack_webhook',
    'teams_workflow_webhook',
    'telegram_bot',
    'webhook_signed',
    'generic_webhook'
];

/** Return all configurable channel types in their picker order. */
export function listConfigurableChannelTypes(): readonly ChannelType[] {
    return CONFIGURABLE_CHANNEL_TYPES;
}

/** Return all channel types including in-app, used for preferences pages. */
export function listAllChannelTypes(): readonly ChannelType[] {
    return Object.keys(CHANNEL_TYPE_META) as ChannelType[];
}

/** Answer: what is the metadata for this channel type? Throws on unknown. */
export function describeChannelType(value: ChannelType): ChannelTypeMeta {
    const meta = CHANNEL_TYPE_META[value];
    if (!meta) {
        throw new Error(`Unknown channel type: ${value as string}`);
    }
    return meta;
}

/** Answer: is this string a known channel type? */
export function isChannelType(value: string): value is ChannelType {
    return value in CHANNEL_TYPE_META;
}

/** Answer: the display label for any string, falling back to the input. */
export function labelForChannelType(value: string): string {
    if (isChannelType(value)) return CHANNEL_TYPE_META[value].label;
    return value;
}

/** Answer: can the backend run a delivery test against this channel? */
export function canTestChannelType(value: ChannelType): boolean {
    return describeChannelType(value).testable;
}
