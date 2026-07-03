import {createHash} from 'node:crypto';
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import type {RateLimiterPort} from '../redis/ports';
import {rateLimiter as defaultRateLimiter} from '../redis/services';
import type {DeliveryContext} from './types';

export interface DeliveryRateLimitDecision {
    allowed: boolean;
    retryAfterSec?: number;
    reason?: string;
}

export interface DeliveryRateLimitInput {
    context: DeliveryContext;
    provider: string;
    limiter?: RateLimiterPort;
}

interface RateLimitBucket {
    key: string;
    capacity: number;
    refillPerSec: number;
    reason: string;
}

const PROVIDER_RATE_SELECTORS: Record<string, () => number> = {
    email_smtp: () => tuning.delivery.rateProviderRpm.emailSmtp,
    generic_webhook: () => tuning.delivery.rateProviderRpm.genericWebhook,
    slack_webhook: () => tuning.delivery.rateProviderRpm.slackWebhook,
    teams_workflow_webhook: () =>
        tuning.delivery.rateProviderRpm.teamsWorkflowWebhook,
    telegram_bot: () => tuning.delivery.rateProviderRpm.telegramBot,
    push_fcm: () => tuning.delivery.rateProviderRpm.pushFcm,
    sms_twilio: () => tuning.delivery.rateProviderRpm.smsTwilio,
    voice_twilio: () => tuning.delivery.rateProviderRpm.voiceTwilio,
    webhook_signed: () => tuning.delivery.rateProviderRpm.webhookSigned
};

export async function enforceDeliveryRateLimit(
    input: DeliveryRateLimitInput
): Promise<DeliveryRateLimitDecision> {
    const limiter = input.limiter ?? defaultRateLimiter;
    const buckets = deliveryRateLimitBuckets(input.context, input.provider);
    // Atomic: a denial consumes nothing, so workers can't double-spend.
    const result = await limiter.consumeMany(buckets, {failClosed: true});
    if (result.allowed) return {allowed: true};
    const reason =
        result.deniedIndex === undefined
            ? 'backend'
            : buckets[result.deniedIndex].reason;
    Observability.incrementLabeledCounter('delivery_rate_limited_total', {
        scope: reason
    });
    return {
        allowed: false,
        retryAfterSec: tuning.delivery.rateRetryAfterSec,
        reason
    };
}

function deliveryRateLimitBuckets(
    context: DeliveryContext,
    provider: string
): RateLimitBucket[] {
    return [
        ...orgBuckets(context),
        ...providerBuckets(context, provider),
        ...endpointBuckets(context, provider),
        ...recipientBuckets(context, provider)
    ];
}

function orgBuckets(context: DeliveryContext): RateLimitBucket[] {
    return makeBucket({
        key: `delivery:org:${context.organizationId}`,
        rpm: tuning.delivery.rateOrgRpm,
        reason: 'organization'
    });
}

function providerBuckets(
    context: DeliveryContext,
    provider: string
): RateLimitBucket[] {
    return makeBucket({
        key: `delivery:provider:${context.organizationId}:${provider}`,
        rpm: providerRpm(provider),
        reason: 'provider'
    });
}

function endpointBuckets(
    context: DeliveryContext,
    provider: string
): RateLimitBucket[] {
    return makeBucket({
        key: `delivery:endpoint:${context.organizationId}:${provider}:${context.endpointId}`,
        rpm: tuning.delivery.rateEndpointRpm,
        reason: 'endpoint'
    });
}

function providerRpm(provider: string): number {
    return PROVIDER_RATE_SELECTORS[provider]?.() ?? 0;
}

// Per-recipient cap on every channel so one recipient can't be stormed up to
// the endpoint RPM; webhook URLs are hashed to keep secrets out of Redis keys.
function recipientBuckets(
    context: DeliveryContext,
    provider: string
): RateLimitBucket[] {
    return recipientsFor(provider, context.config).flatMap((recipient) =>
        makeBucket({
            key: `delivery:recipient:${context.organizationId}:${recipient}`,
            rpm: tuning.delivery.rateRecipientRpm,
            reason: 'recipient'
        })
    );
}

// One home for "who is the recipient" per provider — SSOT for the cap path.
const PROVIDER_RECIPIENT_SELECTORS: Record<
    string,
    (config: Record<string, unknown>) => string[]
> = {
    email_smtp: emailRecipients,
    telegram_bot: (c) => singleRecipient(c.chatId),
    sms_twilio: (c) => singleRecipient(c.to),
    voice_twilio: (c) => singleRecipient(c.to),
    push_fcm: (c) => singleRecipient(c.token),
    slack_webhook: (c) => hashedRecipient(c.url),
    teams_workflow_webhook: (c) => hashedRecipient(c.url),
    generic_webhook: (c) => hashedRecipient(c.url),
    webhook_signed: (c) => hashedRecipient(c.url)
};

function recipientsFor(
    provider: string,
    config: Record<string, unknown>
): string[] {
    return PROVIDER_RECIPIENT_SELECTORS[provider]?.(config) ?? [];
}

function singleRecipient(raw: unknown): string[] {
    if (typeof raw !== 'string') return [];
    const value = raw.trim();
    return value ? [value] : [];
}

function hashedRecipient(raw: unknown): string[] {
    return singleRecipient(raw).map(
        (url) => `url:${createHash('sha256').update(url).digest('hex')}`
    );
}

function makeBucket(input: {
    key: string;
    rpm: number;
    reason: string;
}): RateLimitBucket[] {
    if (input.rpm <= 0) return [];
    return [
        {
            key: input.key,
            capacity: input.rpm,
            refillPerSec: input.rpm / 60,
            reason: input.reason
        }
    ];
}

function emailRecipients(config: Record<string, unknown>): string[] {
    const values = [
        ...readStringList(config.toAddresses),
        ...readStringList(config.ccAddresses),
        ...readStringList(config.bccAddresses)
    ];
    return [
        ...new Set(values.map((value) => value.trim().toLowerCase()))
    ].filter(Boolean);
}

function readStringList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is string => typeof value === 'string');
}
