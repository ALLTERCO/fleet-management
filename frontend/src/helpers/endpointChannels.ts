// Map a channel's provider to the message body it renders.
// WHY: only email/slack/teams have dedicated bodies; the rest use the fallback.

import type {ChannelProvider} from '@api/channel';

/** The template body a channel renders from. */
export type BodyKind = 'email' | 'slack' | 'teams' | 'fallback';

interface ProviderMeta {
    readonly label: string;
    readonly bodyKind: BodyKind;
}

const PROVIDER_META: Readonly<Record<ChannelProvider, ProviderMeta>> = {
    email_smtp: {label: 'Email', bodyKind: 'email'},
    slack_webhook: {label: 'Slack', bodyKind: 'slack'},
    teams_workflow_webhook: {label: 'Teams', bodyKind: 'teams'},
    telegram_bot: {label: 'Telegram', bodyKind: 'fallback'},
    push_fcm: {label: 'Push', bodyKind: 'fallback'},
    sms_twilio: {label: 'SMS', bodyKind: 'fallback'},
    voice_twilio: {label: 'Voice', bodyKind: 'fallback'},
    generic_webhook: {label: 'Webhook', bodyKind: 'fallback'},
    webhook_signed: {label: 'Signed webhook', bodyKind: 'fallback'}
};

/** Answer: the message body a provider renders from. */
export function providerBodyKind(provider: ChannelProvider): BodyKind {
    return PROVIDER_META[provider]?.bodyKind ?? 'fallback';
}

/** Answer: a friendly label for a provider. */
export function providerChannelLabel(provider: ChannelProvider): string {
    return PROVIDER_META[provider]?.label ?? provider;
}

export interface ChannelSummary {
    readonly label: string;
    readonly bodyKind: BodyKind;
}

/** Answer: the unique channels the selected channels notify, deduped by
 *  label, in the order they first appear. */
export function channelsForChannels(
    channels: ReadonlyArray<{id: number; provider: ChannelProvider}>,
    selectedIds: readonly number[]
): ChannelSummary[] {
    const selected = new Set(selectedIds);
    const seen = new Set<string>();
    const out: ChannelSummary[] = [];
    for (const ep of channels) {
        if (!selected.has(ep.id) || seen.has(ep.provider)) continue;
        seen.add(ep.provider);
        out.push({
            label: providerChannelLabel(ep.provider),
            bodyKind: providerBodyKind(ep.provider)
        });
    }
    return out;
}
