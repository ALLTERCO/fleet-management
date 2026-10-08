// Single source of truth for the notification-channel edit draft.
//
// Two translations live here and nowhere else: a saved Channel becomes an
// editable draft, and a draft becomes the config object `channel.create` and
// `channel.update` accept. The backend validates every config against the
// provider's own schema with `additionalProperties: false`, so each provider
// gets its own draft section — a field belonging to one provider must never
// reach another.

import type {Channel, ChannelProvider} from '@api/channel';
import type {QuietHoursForm} from '@/components/core/QuietHoursSummary.vue';
import {type ChannelType, isChannelType} from '@/helpers/channelTypes';
import {
    buildEmailChannelConfig,
    createEmailChannelConfigForm,
    type EmailChannelConfigForm,
    fillEmailChannelConfigForm
} from '@/helpers/notificationEmailConfig';

export interface WebhookConfigForm {
    url: string;
    signingSecret: string;
    timeoutMs: number;
}

export interface SlackConfigForm {
    url: string;
    channelOverride: string;
}

export interface TeamsConfigForm {
    url: string;
}

export interface TelegramConfigForm {
    botToken: string;
    chatId: string;
    parseMode: '' | 'MarkdownV2' | 'HTML';
}

export interface PushFcmConfigForm {
    token: string;
    platform: 'ios' | 'android' | 'webpush';
    env: 'prod' | 'sandbox';
}

export interface WebhookSignedConfigForm {
    url: string;
    signingSecret: string;
    timeoutMs: number;
}

export interface ChannelDraftConfig {
    email: EmailChannelConfigForm;
    webhook: WebhookConfigForm;
    slack: SlackConfigForm;
    teams: TeamsConfigForm;
    telegram: TelegramConfigForm;
    pushFcm: PushFcmConfigForm;
    webhookSigned: WebhookSignedConfigForm;
}

export interface ChannelDraft {
    channelId: number | null;
    name: string;
    type: ChannelType;
    config: ChannelDraftConfig;
    quietHours: QuietHoursForm;
}

export interface QuietHoursPatch {
    startHour: number;
    endHour: number;
    timezone: string;
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 10000;
const DEFAULT_SMTP_TIMEZONE = 'UTC';
const HOUR_MIN = 0;
const START_HOUR_MAX = 23;
// Exclusive end. 24 is end-of-day, so 0-24 mutes the whole day.
const END_HOUR_MAX = 24;

export function createBlankChannelDraft(): ChannelDraft {
    return {
        channelId: null,
        name: '',
        type: 'email_smtp',
        config: {
            email: createEmailChannelConfigForm(),
            webhook: {
                url: '',
                signingSecret: '',
                timeoutMs: DEFAULT_WEBHOOK_TIMEOUT_MS
            },
            slack: {url: '', channelOverride: ''},
            teams: {url: ''},
            telegram: {botToken: '', chatId: '', parseMode: ''},
            // Platform is preselected: the schema has no blank member, so an
            // unset radio would only show an error the user cannot avoid.
            pushFcm: {token: '', platform: 'android', env: 'prod'},
            webhookSigned: {
                url: '',
                signingSecret: '',
                timeoutMs: DEFAULT_WEBHOOK_TIMEOUT_MS
            }
        },
        quietHours: {start: '', end: '', timezone: ''}
    };
}

type ConfigWriter = (config: ChannelDraftConfig) => Record<string, unknown>;

// Provider → the draft section that owns its fields. Adding a provider means
// adding one row here, one row in CONFIG_READERS, and one fieldset.
const CONFIG_WRITERS: Partial<Record<ChannelType, ConfigWriter>> = {
    email_smtp: (config) => buildEmailChannelConfig(config.email),
    generic_webhook: (config) => withoutBlanks(config.webhook),
    slack_webhook: (config) => withoutBlanks(config.slack),
    teams_workflow_webhook: (config) => withoutBlanks(config.teams),
    telegram_bot: (config) => withoutBlanks(config.telegram),
    push_fcm: (config) => withoutBlanks(config.pushFcm),
    webhook_signed: (config) => withoutBlanks(config.webhookSigned)
};

type ConfigReader = (
    config: ChannelDraftConfig,
    stored: Record<string, unknown>
) => void;

const CONFIG_READERS: Partial<Record<ChannelType, ConfigReader>> = {
    email_smtp: (config, stored) =>
        fillEmailChannelConfigForm(config.email, stored),
    generic_webhook: (config, stored) => copyKnownKeys(config.webhook, stored),
    slack_webhook: (config, stored) => copyKnownKeys(config.slack, stored),
    teams_workflow_webhook: (config, stored) =>
        copyKnownKeys(config.teams, stored),
    telegram_bot: (config, stored) => copyKnownKeys(config.telegram, stored),
    push_fcm: (config, stored) => copyKnownKeys(config.pushFcm, stored),
    webhook_signed: (config, stored) =>
        copyKnownKeys(config.webhookSigned, stored)
};

/** Answer: is this channel type backed by a form the user can fill in? */
export function isConfigurableChannelType(type: ChannelType): boolean {
    return type in CONFIG_WRITERS;
}

/**
 * The config object for the draft's own type.
 *
 * Throws on a type with no form rather than returning an empty object — an
 * empty config reaches the server as a schema violation the user cannot read.
 */
export function buildChannelConfigFromDraft(
    draft: ChannelDraft
): Record<string, unknown> {
    const write = CONFIG_WRITERS[draft.type];
    if (!write) {
        throw new Error(`Channel type ${draft.type} has no configuration form`);
    }
    return write(draft.config);
}

export function buildDraftFromChannel(channel: Channel): ChannelDraft {
    const draft = createBlankChannelDraft();
    draft.channelId = channel.id;
    draft.name = channel.name;
    draft.type = toChannelType(channel.provider);
    draft.quietHours = toQuietHoursForm(channel.quietHours);
    readStoredConfig(draft, channel.config);
    return draft;
}

/**
 * The quietHours patch for the RPC, or null when the form is not a window.
 *
 * Equal hours are not a window — the backend reads them as "mute nothing", and
 * they are also exactly what an untouched form holds. Sending them wrote a
 * no-op window that the UI then displayed as an armed quiet period.
 */
export function readQuietHoursPatch(
    form: QuietHoursForm
): QuietHoursPatch | null {
    const startHour = Number(form.start);
    const endHour = Number(form.end);
    if (!isStartHour(startHour) || !isEndHour(endHour)) return null;
    if (startHour === endHour) return null;
    return {
        startHour,
        endHour,
        timezone: form.timezone.trim() || DEFAULT_SMTP_TIMEZONE
    };
}

/** Answer: does this form describe a window that actually mutes anything? */
export function mutesAnything(form: QuietHoursForm): boolean {
    return readQuietHoursPatch(form) !== null;
}

function readStoredConfig(
    draft: ChannelDraft,
    stored: Record<string, unknown>
): void {
    const read = CONFIG_READERS[draft.type];
    if (read) read(draft.config, stored);
}

function toChannelType(provider: ChannelProvider): ChannelType {
    return isChannelType(provider) ? provider : 'email_smtp';
}

function toQuietHoursForm(quietHours: Channel['quietHours']): QuietHoursForm {
    if (!quietHours) return {start: '', end: '', timezone: ''};
    return {
        start: String(quietHours.startHour),
        end: String(quietHours.endHour),
        timezone: quietHours.timezone ?? ''
    };
}

function isStartHour(value: number): boolean {
    return (
        Number.isInteger(value) &&
        value >= HOUR_MIN &&
        value <= START_HOUR_MAX
    );
}

function isEndHour(value: number): boolean {
    return (
        Number.isInteger(value) && value >= HOUR_MIN && value <= END_HOUR_MAX
    );
}

/** Empty strings mean "not filled in", not "clear this field". */
function withoutBlanks(source: object): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
        if (value === '' || value === null || value === undefined) continue;
        result[key] = value;
    }
    return result;
}

/** Copies only the keys the form section already declares. */
function copyKnownKeys<T extends object>(
    target: T,
    stored: Record<string, unknown>
): void {
    for (const key of Object.keys(target) as Array<keyof T & string>) {
        const value = stored[key];
        if (value !== undefined) target[key as keyof T] = value as T[keyof T];
    }
}
