// Prepares a delivery for a channel when the rule carries a message template.
// One place that turns (payload + provider) into the rendered channel body
// plus the (possibly fallback-overridden) message — reused by the send path
// and unit-tested directly. Rendering itself is delegated to the single
// authority, renderMessageTemplateForChannel.

import type {ChannelProvider} from '../../types/api/channel';
import {buildDeliveryContext} from '../alert/templateContext';
import {
    type ChannelRender,
    renderMessageTemplateForChannel
} from '../notification/messageTemplateRender';
import type {DeliveryPayload, ResolvedMessageTemplate} from './types';

export interface PreparedTemplatedSend {
    /** Message to send — fallbackText folded into `.message` when the channel
     *  has no dedicated body, otherwise the original. */
    message: DeliveryPayload;
    /** Rendered body for this channel; undefined when no template applies.
     *  Adapters read it for the structured (slack/teams/email) channels. */
    templateBody?: ChannelRender;
}

/** Read an endpoint's message-template reference from its config. Returns null
 *  when absent or malformed. Pure — the DB lookup happens in the caller. */
export function endpointTemplateId(
    config: Record<string, unknown>
): number | null {
    const id = config.templateId;
    return typeof id === 'number' && Number.isFinite(id) && id > 0 ? id : null;
}

export function prepareTemplatedSend(
    message: DeliveryPayload,
    provider: ChannelProvider,
    template: ResolvedMessageTemplate | null = message.template ?? null
): PreparedTemplatedSend {
    if (!template) return {message};
    const templateBody = renderMessageTemplateForChannel(
        template,
        provider,
        buildDeliveryContext(message)
    );
    // No channel-specific body -> fallbackText becomes the message every
    // plain-text channel sends. Rich channels read templateBody instead.
    const next =
        templateBody.usedFallback && typeof templateBody.rendered === 'string'
            ? {...message, message: templateBody.rendered}
            : message;
    return {message: next, templateBody};
}
