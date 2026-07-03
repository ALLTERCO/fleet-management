/**
 * Adapter registry. The OutboxWorker looks up a `DeliveryAdapter` by
 * provider key — adding a new provider is a one-line registration plus
 * a new file.
 */
import type {ChannelProvider} from '../../../types/api/channel';
import type {DeliveryAdapter} from '../types';
import {genericWebhookAdapter} from './genericWebhook';
import {pushFcmAdapter} from './pushFcm';
import {slackWebhookAdapter} from './slackWebhook';
import {smsTwilioAdapter} from './smsTwilio';
import {smtpAdapter} from './smtp';
import {teamsWorkflowAdapter} from './teamsWorkflow';
import {telegramBotAdapter} from './telegramBot';
import {voiceTwilioAdapter} from './voiceTwilio';
import {webhookSignedAdapter} from './webhookSignedAdapter';

const ADAPTERS: Partial<Record<ChannelProvider, DeliveryAdapter>> = {
    email_smtp: smtpAdapter,
    generic_webhook: genericWebhookAdapter,
    slack_webhook: slackWebhookAdapter,
    teams_workflow_webhook: teamsWorkflowAdapter,
    telegram_bot: telegramBotAdapter,
    push_fcm: pushFcmAdapter,
    sms_twilio: smsTwilioAdapter,
    voice_twilio: voiceTwilioAdapter,
    webhook_signed: webhookSignedAdapter
};

export function getAdapter(
    provider: ChannelProvider
): DeliveryAdapter | undefined {
    return ADAPTERS[provider];
}

export function supportedProviders(): ChannelProvider[] {
    return Object.keys(ADAPTERS) as ChannelProvider[];
}

// Test seam: swap in a stub adapter, get a teardown that restores the
// original. Used to assert delivery wiring without hitting the network.
export function __setAdapterForTests(
    provider: ChannelProvider,
    stub: DeliveryAdapter
): () => void {
    const prev = ADAPTERS[provider];
    ADAPTERS[provider] = stub;
    return () => {
        if (prev) ADAPTERS[provider] = prev;
        else delete ADAPTERS[provider];
    };
}
