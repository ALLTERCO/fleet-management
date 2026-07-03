// Pure validators for notification-channel form fields.
//
// Each validator answers "is this value acceptable?" and never mutates
// anything. The result type is a discriminated union so callers can branch
// on `.valid` and trust TypeScript to narrow the message access.
//
// Naming convention: each function reads as `validate<What>` and its
// matching test reads as a sentence about the rule it enforces.

export type ValidationResult = {valid: true} | {valid: false; message: string};

const VALID: ValidationResult = {valid: true};

function invalid(message: string): ValidationResult {
    return {valid: false, message};
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEZONE_PATTERN = /^[A-Za-z]+(?:[/_+\-A-Za-z0-9]+)*$/;
const SLACK_WEBHOOK_HOST = 'hooks.slack.com';
const TEAMS_WORKFLOW_HOST_SUFFIX = '.logic.azure.com';
const TELEGRAM_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;

const CHANNEL_NAME_MAX = 64;
const CHANNEL_NAME_MIN = 2;

/** Channel name is required, length-bounded, and trimmed. */
export function validateChannelName(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('Name is required');
    if (trimmed.length < CHANNEL_NAME_MIN)
        return invalid(`Name must be at least ${CHANNEL_NAME_MIN} characters`);
    if (trimmed.length > CHANNEL_NAME_MAX)
        return invalid(`Name must be at most ${CHANNEL_NAME_MAX} characters`);
    return VALID;
}

/** Single RFC-5322-ish email address. */
export function validateEmailAddress(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('Email is required');
    if (!EMAIL_PATTERN.test(trimmed))
        return invalid('Enter a valid email address');
    return VALID;
}

/** Comma-separated recipient list; each entry must validate. */
export function validateEmailRecipientList(value: string): ValidationResult {
    const entries = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (entries.length === 0) return invalid('At least one recipient required');
    for (const entry of entries) {
        const result = validateEmailAddress(entry);
        if (!result.valid) return invalid(`"${entry}" is not a valid email`);
    }
    return VALID;
}

/** SMTP host must look like a DNS hostname. */
export function validateSmtpHost(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('SMTP host is required');
    if (trimmed.includes(' '))
        return invalid('SMTP host cannot contain spaces');
    return VALID;
}

/** SMTP port must be a positive integer in the legal TCP range. */
export function validateSmtpPort(value: number | string): ValidationResult {
    const port = typeof value === 'string' ? Number(value) : value;
    if (!Number.isInteger(port)) return invalid('Port must be a whole number');
    if (port < 1 || port > 65535) return invalid('Port must be 1–65535');
    return VALID;
}

/** Webhook URL must be https with a non-empty host. */
export function validateWebhookUrl(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('URL is required');
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return invalid('Enter a valid URL');
    }
    if (parsed.protocol !== 'https:')
        return invalid('Webhook URL must use https://');
    if (!parsed.host) return invalid('URL must include a host');
    return VALID;
}

/** Slack webhook URL must be https and hosted on hooks.slack.com. */
export function validateSlackWebhookUrl(value: string): ValidationResult {
    const base = validateWebhookUrl(value);
    if (!base.valid) return base;
    const parsed = new URL(value.trim());
    if (parsed.host !== SLACK_WEBHOOK_HOST)
        return invalid('Slack webhook must be hosted on hooks.slack.com');
    return VALID;
}

/** Teams workflow URL must be on a logic.azure.com subdomain. */
export function validateTeamsWorkflowUrl(value: string): ValidationResult {
    const base = validateWebhookUrl(value);
    if (!base.valid) return base;
    const parsed = new URL(value.trim());
    if (!parsed.host.endsWith(TEAMS_WORKFLOW_HOST_SUFFIX))
        return invalid('Teams URL must be a logic.azure.com workflow endpoint');
    return VALID;
}

/** Telegram bot token shape: digits, colon, 20+ token chars. */
export function validateTelegramBotToken(value: string): ValidationResult {
    if (value.length === 0) return invalid('Bot token is required');
    if (!TELEGRAM_TOKEN_PATTERN.test(value))
        return invalid('Token does not match the expected Telegram format');
    return VALID;
}

/** Telegram chat ID may be negative for groups; must be a non-empty integer. */
export function validateTelegramChatId(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('Chat ID is required');
    if (!/^-?\d+$/.test(trimmed))
        return invalid('Chat ID must be a positive or negative integer');
    return VALID;
}

/** Quiet-hours bound is an integer in [0, 23]. */
export function validateQuietHourBound(
    value: number | string
): ValidationResult {
    const hour = typeof value === 'string' ? Number(value) : value;
    if (!Number.isInteger(hour)) return invalid('Hour must be a whole number');
    if (hour < 0 || hour > 23) return invalid('Hour must be between 0 and 23');
    return VALID;
}

/** IANA timezone — pragmatic regex; the backend is authoritative. */
export function validateTimezone(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('Timezone is required');
    if (!TIMEZONE_PATTERN.test(trimmed))
        return invalid('Enter an IANA timezone like Europe/Sofia');
    return VALID;
}

/** Timeout in milliseconds — at least 1s, at most 60s. */
export function validateWebhookTimeoutMs(
    value: number | string
): ValidationResult {
    const ms = typeof value === 'string' ? Number(value) : value;
    if (!Number.isInteger(ms)) return invalid('Timeout must be a whole number');
    if (ms < 1000 || ms > 60000)
        return invalid('Timeout must be between 1000 and 60000 ms');
    return VALID;
}

const FCM_TOKEN_MAX = 4096;
const HMAC_SECRET_MIN = 32;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const PUSH_PLATFORMS = new Set(['ios', 'android', 'webpush']);

/** FCM device token — non-empty, capped at the server-side limit. */
export function validateFcmToken(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('Device token is required');
    if (trimmed.length > FCM_TOKEN_MAX)
        return invalid(`Token must be at most ${FCM_TOKEN_MAX} characters`);
    return VALID;
}

/** Push platform must be one of the supported FCM transports. */
export function validatePushPlatform(value: string): ValidationResult {
    if (!PUSH_PLATFORMS.has(value))
        return invalid('Platform must be ios, android, or webpush');
    return VALID;
}

/** E.164 phone number for Twilio SMS / Voice. */
export function validateE164(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('Phone number is required');
    if (!E164_PATTERN.test(trimmed))
        return invalid('Use E.164 format like +15555550100');
    return VALID;
}

/** TwiML URL — https only, non-empty host. */
export function validateTwimlUrl(value: string): ValidationResult {
    return validateWebhookUrl(value);
}

/** HMAC signing secret — at least 32 chars of entropy. */
export function validateHmacSecret(value: string): ValidationResult {
    if (value.length === 0) return invalid('Signing secret is required');
    if (value.length < HMAC_SECRET_MIN)
        return invalid(`Secret must be at least ${HMAC_SECRET_MIN} characters`);
    return VALID;
}

// -----------------------------------------------------------------------------
// Per-type aggregate validators — produce a {field → error-message} map so
// the modal can render inline errors without re-deriving them everywhere.
// Empty object means the form is valid.
// -----------------------------------------------------------------------------

export type ErrorMap = Readonly<Record<string, string>>;

function collect(pairs: ReadonlyArray<[string, ValidationResult]>): ErrorMap {
    const errors: Record<string, string> = {};
    for (const [field, result] of pairs) {
        if (!result.valid) errors[field] = result.message;
    }
    return errors;
}

export interface EmailFormShape {
    mode: 'use_system_smtp' | 'custom_smtp';
    from: string;
    toAddresses: string;
    host: string;
    port: number;
    authUser: string;
    authPass: string;
}

export function validateEmailForm(form: EmailFormShape): ErrorMap {
    const recipients = validateEmailRecipientList(form.toAddresses);
    if (form.mode === 'use_system_smtp') {
        return collect([['toAddresses', recipients]]);
    }
    return collect([
        ['from', validateEmailAddress(form.from)],
        ['toAddresses', recipients],
        ['host', validateSmtpHost(form.host)],
        ['port', validateSmtpPort(form.port)]
    ]);
}

export interface WebhookFormShape {
    url: string;
    timeoutMs: number;
}

export function validateWebhookForm(form: WebhookFormShape): ErrorMap {
    return collect([
        ['url', validateWebhookUrl(form.url)],
        ['timeoutMs', validateWebhookTimeoutMs(form.timeoutMs)]
    ]);
}

export interface SlackFormShape {
    url: string;
}

export function validateSlackForm(form: SlackFormShape): ErrorMap {
    return collect([['url', validateSlackWebhookUrl(form.url)]]);
}

export interface TeamsFormShape {
    url: string;
}

export function validateTeamsForm(form: TeamsFormShape): ErrorMap {
    return collect([['url', validateTeamsWorkflowUrl(form.url)]]);
}

export interface TelegramFormShape {
    botToken: string;
    chatId: string;
}

export function validateTelegramForm(form: TelegramFormShape): ErrorMap {
    return collect([
        ['botToken', validateTelegramBotToken(form.botToken)],
        ['chatId', validateTelegramChatId(form.chatId)]
    ]);
}

export interface PushFcmFormShape {
    token: string;
    platform: string;
}

export function validatePushFcmForm(form: PushFcmFormShape): ErrorMap {
    return collect([
        ['token', validateFcmToken(form.token)],
        ['platform', validatePushPlatform(form.platform)]
    ]);
}

export interface SmsTwilioFormShape {
    to: string;
    from: string;
}

export function validateSmsTwilioForm(form: SmsTwilioFormShape): ErrorMap {
    return collect([
        ['to', validateE164(form.to)],
        ['from', validateE164(form.from)]
    ]);
}

export interface VoiceTwilioFormShape {
    to: string;
    from: string;
    twimlUrl: string;
}

export function validateVoiceTwilioForm(form: VoiceTwilioFormShape): ErrorMap {
    return collect([
        ['to', validateE164(form.to)],
        ['from', validateE164(form.from)],
        ['twimlUrl', validateTwimlUrl(form.twimlUrl)]
    ]);
}

export interface WebhookSignedFormShape {
    url: string;
    signingSecret: string;
    timeoutMs: number;
}

export function validateWebhookSignedForm(
    form: WebhookSignedFormShape
): ErrorMap {
    return collect([
        ['url', validateWebhookUrl(form.url)],
        ['signingSecret', validateHmacSecret(form.signingSecret)],
        ['timeoutMs', validateWebhookTimeoutMs(form.timeoutMs)]
    ]);
}
