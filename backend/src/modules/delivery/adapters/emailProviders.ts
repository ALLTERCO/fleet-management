// Email provider abstraction. SMTP stays the default for self-hosted
// installs; SES/SendGrid/Postmark plug in as alternative providers behind
// the same dispatch + failover shape.

import type {DeliveryPayload} from '../types';

export type EmailProvider = 'smtp' | 'ses' | 'sendgrid' | 'postmark';

export interface EmailAddress {
    /** Canonical RFC 5322 mailbox. */
    address: string;
    name?: string;
}

export interface EmailRenderedMessage {
    subject: string;
    html: string;
    text: string;
}

export interface EmailDeliveryRequest {
    to: EmailAddress;
    from: EmailAddress;
    replyTo?: EmailAddress;
    rendered: EmailRenderedMessage;
    payload: DeliveryPayload;
    /** Stable id appended to subject for reply-to-ack parsing. */
    ackTag?: string;
}

export interface EmailDeliveryResult {
    success: boolean;
    provider: EmailProvider | null;
    providerMessageId?: string;
    bounceReason?: 'hard' | 'soft' | 'complaint';
    retryable?: boolean;
    errorMessage?: string;
}

export type EmailProviderSendFn = (params: {
    provider: EmailProvider;
    request: EmailDeliveryRequest;
}) => Promise<EmailDeliveryResult>;

// Conservative RFC-5322-like check that catches the common authoring
// mistakes (missing @ / domain / TLD) without rejecting valid addresses.
export function isValidEmail(address: string): boolean {
    if (address.length > 254 || address.length < 3) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address);
}

// Append ack tag for reply-to-ack parsing. Subject lives in the headline,
// the ack tag at the end so most mail clients still render the original
// subject in the inbox list.
export function applyAckTag(
    subject: string,
    ackTag: string | undefined
): string {
    if (!ackTag) return subject;
    return `${subject} [FM-ACK:${ackTag}]`;
}

// Strict regex to recover the ackTag from inbound replies — receivers
// scan inbound mail subjects against this.
const ACK_TAG_RE = /\[FM-ACK:([A-Za-z0-9:_-]+)\]/;
export function extractAckTag(subject: string): string | null {
    const m = ACK_TAG_RE.exec(subject);
    return m ? m[1] : null;
}

export async function sendEmail(
    request: EmailDeliveryRequest,
    providerSend: EmailProviderSendFn,
    providers: readonly EmailProvider[] = ['smtp']
): Promise<EmailDeliveryResult> {
    if (!isValidEmail(request.to.address)) {
        return {
            success: false,
            provider: null,
            errorMessage: 'invalid recipient address'
        };
    }
    if (!isValidEmail(request.from.address)) {
        return {
            success: false,
            provider: null,
            errorMessage: 'invalid sender address'
        };
    }
    const tagged: EmailDeliveryRequest = {
        ...request,
        rendered: {
            ...request.rendered,
            subject: applyAckTag(request.rendered.subject, request.ackTag)
        }
    };
    let last: EmailDeliveryResult | null = null;
    for (const provider of providers) {
        const result = await providerSend({provider, request: tagged});
        if (result.success) return {...result, provider};
        // Hard bounce / complaint = don't try another provider. The
        // recipient is the problem, not the channel.
        if (
            result.bounceReason === 'hard' ||
            result.bounceReason === 'complaint'
        ) {
            return result;
        }
        last = result;
        if (!result.retryable) break;
    }
    return {
        success: false,
        provider: null,
        errorMessage: last?.errorMessage ?? 'all email providers failed',
        retryable: last?.retryable ?? false
    };
}
