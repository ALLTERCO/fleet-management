// Signed webhook adapter. Same shape as generic_webhook but injects an
// fm-signature header (HMAC-SHA256, Stripe-style t=,v1=). Recipient
// verifies with signWebhook from webhookSigning.ts.

import {readNumber, readString} from '../../util/objectReaders';
import type {DeliveryAdapter, DeliveryResult} from '../types';
import {postRawWithTimeout} from './_http';
import {signWebhook, WEBHOOK_SIGNATURE_HEADER} from './webhookSigning';

interface HeaderEntry {
    name: string;
    value?: string;
}

function readHeaders(obj: Record<string, unknown>): HeaderEntry[] {
    const raw = obj.headers;
    if (!Array.isArray(raw)) return [];
    const out: HeaderEntry[] = [];
    for (const h of raw) {
        if (!h || typeof h !== 'object') continue;
        const name = (h as HeaderEntry).name;
        if (typeof name !== 'string' || !name) continue;
        out.push({
            name,
            value:
                typeof (h as HeaderEntry).value === 'string'
                    ? (h as HeaderEntry).value
                    : undefined
        });
    }
    return out;
}

export const webhookSignedAdapter: DeliveryAdapter = {
    provider: 'webhook_signed',
    async send(payload, context): Promise<DeliveryResult> {
        const url = readString(context.config, 'url');
        const secret = readString(context.config, 'signingSecret');
        if (!url || !secret) {
            return {
                state: 'failed',
                errorMessage:
                    'webhook_signed config missing url or signingSecret.'
            };
        }
        // Reject http:// — signature would leak to any on-path observer.
        if (!url.startsWith('https://')) {
            return {
                state: 'failed',
                errorMessage:
                    'webhook_signed url must be https:// (signature in clear text on http would leak).'
            };
        }
        const body = JSON.stringify(payload);
        const sig = signWebhook({body, secret});
        const timeoutMs = readNumber(context.config, 'timeoutMs') ?? 30_000;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            [WEBHOOK_SIGNATURE_HEADER]: sig
        };
        for (const h of readHeaders(context.config)) {
            if (h.value !== undefined) headers[h.name] = h.value;
        }
        return safeHttpPost({
            url,
            headers,
            body,
            timeoutMs,
            organizationId: payload.organizationId
        });
    }
};

interface HttpPostInput {
    url: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    organizationId: string;
}

// Error handling lives in its own function; logic above stays linear.
async function safeHttpPost(input: HttpPostInput): Promise<DeliveryResult> {
    try {
        return await runHttpPost(input);
    } catch (err) {
        return {
            state: 'failed',
            errorMessage:
                err instanceof Error
                    ? err.message
                    : String(err ?? 'webhook send failed'),
            retryAfterSec: 60
        };
    }
}

// postRawWithTimeout applies SSRF guard + breaker. Body passed verbatim:
// the signature covers the exact bytes.
async function runHttpPost(input: HttpPostInput): Promise<DeliveryResult> {
    const res = await postRawWithTimeout({
        url: input.url,
        body: input.body,
        headers: input.headers,
        timeoutMs: input.timeoutMs,
        organizationId: input.organizationId
    });
    if ('error' in res) {
        return {
            state: 'failed',
            errorMessage: res.error,
            retryAfterSec: 60
        };
    }
    if (res.ok) {
        return {
            state: 'succeeded',
            httpStatus: res.status,
            providerCode: null
        };
    }
    return {
        state: 'failed',
        httpStatus: res.status,
        errorMessage: `webhook ${res.status}: ${res.bodySnippet}`,
        retryAfterSec: res.status >= 500 || res.status === 429 ? 60 : null
    };
}
