/**
 * Delivery-pipeline shared types. The OutboxWorker claims a delivery
 * job, resolves the endpoint adapter, and calls `send`. The adapter
 * returns a normalized result the worker records verbatim in
 * delivery_attempts.
 */

import type {AlertScopeType} from '../../types/api/alert';
import type {ChannelProvider} from '../../types/api/channel';
import type {MessageTemplateBodies} from '../../types/api/notification';
import type {ChannelRender} from '../notification/messageTemplateRender';

/** Resolved rule message template carried on the payload for the send-time
 *  overlay. Null/absent = the rule uses its own title/message wording. */
export interface ResolvedMessageTemplate {
    bodies: MessageTemplateBodies;
    fallbackText: string;
}

export interface DeliveryPayload {
    title: string;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    organizationId: string;
    alertId: number | null;
    ruleId: number | null;
    ruleName: string;
    ruleKind: string;
    /** Optional rule runbook URL surfaced via the {{rule.runbookUrl}} token. */
    ruleRunbookUrl?: string | null;
    // Extra context fields carried through to per-provider rich templates
    // so the renderer has the same data preview + delivery use.
    state:
        | 'pending'
        | 'active'
        | 'acknowledged'
        | 'recovering'
        | 'cleared_unack'
        | 'cleared_ack'
        | 'no_data'
        | 'evaluation_error'
        | 'resolved';
    firedAt: string;
    activeSince: string;
    source?: {
        subjectType: AlertScopeType;
        subjectId: string;
    } | null;
    labels?: Record<string, string>;
    context?: Record<string, unknown>;
    /** Grouped delivery: additional alerts batched with this one. Adapters
     *  render leader + siblings as a single multi-alert notification.
     *  Undefined = single-alert (legacy path). */
    siblings?: DeliveryPayload[];
    /** Aggregate metadata, populated only when siblings is non-empty. */
    aggregate?: DeliveryAggregate;
    /** Resolved rule message template (rule.templateId). Overlaid per channel
     *  at send time. Absent/null = rule uses its own title/message wording. */
    template?: ResolvedMessageTemplate | null;
}

export interface DeliveryAggregate {
    total: number;
    critical: number;
    warning: number;
    info: number;
    firstAt: string;
    lastAt: string;
}

export interface DeliveryContext {
    jobId: number;
    organizationId: string;
    endpointId: number;
    endpointName: string;
    /** Merged public config + decrypted secrets. Adapters read secrets
     *  at their schema path (e.g. config.auth.pass), not a separate bag. */
    config: Record<string, unknown>;
    /** providerCode of the most recent successful delivery to the same
     *  alertId+endpoint. Stateful adapters (Telegram editMessageText)
     *  use it to update the original message on state change. */
    previousSuccessfulProviderCode?: string;
    /** Pre-rendered rule-template body for THIS channel, produced once by the
     *  single render authority (renderMessageTemplateForChannel). When present,
     *  adapters send this instead of deriving from their own config template.
     *  Absent = rule has no template; adapters use their normal path. */
    templateBody?: ChannelRender;
}

export interface DeliveryResult {
    state: 'succeeded' | 'failed';
    httpStatus?: number | null;
    providerCode?: string | null;
    errorMessage?: string | null;
    /** Minimum seconds the worker should wait before the next retry.
     *  Set from upstream Retry-After on 429/503 so throttled endpoints
     *  back off properly instead of burning graphile-worker's exponential. */
    retryAfterSec?: number | null;
    /** Worker-internal: a deferral, not a failed attempt — reschedule a fresh
     *  job after retryAfterSec WITHOUT consuming a retry or recording an
     *  attempt. Set by the rate limiter so a throttle (or a Redis outage under
     *  fail-closed) never dead-letters a real alert. Adapters never set this. */
    deferWithoutAttempt?: boolean;
}

export interface DeliveryAdapter {
    provider: ChannelProvider;
    send(
        payload: DeliveryPayload,
        context: DeliveryContext
    ): Promise<DeliveryResult>;
    /** Optional — validate reachability/auth without sending. Called
     *  first by Channel.Test so misconfig surfaces before
     *  a real message goes out. SMTP implements via transporter.verify(). */
    verify?(context: DeliveryContext): Promise<void>;
}
