// Stripe-style outbound webhook signing. Header format:
//   FM-Signature: t=<unix>,v1=<sha256(t.body)>
// Receiver verifies against the RAW body bytes (post-parse re-serialization
// will not produce the same hash).

import {createHmac, timingSafeEqual} from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'fm-signature';
const SIGNATURE_VERSION = 'v1';
/** Reject signatures whose timestamp is more than this far in the past. */
export const DEFAULT_MAX_AGE_SEC = 300;
/** Reject signatures whose timestamp is more than this far in the future. */
export const DEFAULT_MAX_CLOCK_SKEW_SEC = 60;

export interface SignWebhookInput {
    /** Raw request body bytes — sign exactly what goes on the wire. */
    body: string;
    secret: string;
    /** Unix seconds; defaults to Date.now()/1000 at call time. */
    timestamp?: number;
}

export function signWebhook(input: SignWebhookInput): string {
    const ts = input.timestamp ?? Math.floor(Date.now() / 1000);
    const digest = computeSignature(input.body, input.secret, ts);
    return `t=${ts},${SIGNATURE_VERSION}=${digest}`;
}

function computeSignature(
    body: string,
    secret: string,
    timestamp: number
): string {
    return createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
}

export interface VerifyWebhookInput {
    header: string;
    body: string;
    /**
     * One or more secrets the receiver currently honors. Multiple
     * accepted so a key rotation can keep the previous key live for
     * the grace window.
     */
    secrets: readonly string[];
    nowMs?: number;
    maxAgeSec?: number;
    maxClockSkewSec?: number;
}

export type WebhookVerifyResult =
    | {valid: true; timestamp: number; matchedSecret: string}
    | {
          valid: false;
          reason:
              | 'malformed'
              | 'missing_timestamp'
              | 'missing_signature'
              | 'timestamp_out_of_window'
              | 'signature_mismatch';
      };

export function verifyWebhookSignature(
    input: VerifyWebhookInput
): WebhookVerifyResult {
    const parsed = parseHeader(input.header);
    if (!parsed) return {valid: false, reason: 'malformed'};
    if (parsed.timestamp == null)
        return {valid: false, reason: 'missing_timestamp'};
    if (!parsed.signature) return {valid: false, reason: 'missing_signature'};

    const nowMs = input.nowMs ?? Date.now();
    const maxAge = input.maxAgeSec ?? DEFAULT_MAX_AGE_SEC;
    const maxSkew = input.maxClockSkewSec ?? DEFAULT_MAX_CLOCK_SKEW_SEC;
    const nowSec = Math.floor(nowMs / 1000);
    const delta = nowSec - parsed.timestamp;
    if (delta > maxAge || delta < -maxSkew) {
        return {valid: false, reason: 'timestamp_out_of_window'};
    }

    for (const secret of input.secrets) {
        const expected = computeSignature(input.body, secret, parsed.timestamp);
        if (constantTimeEqualHex(parsed.signature, expected)) {
            return {
                valid: true,
                timestamp: parsed.timestamp,
                matchedSecret: secret
            };
        }
    }
    return {valid: false, reason: 'signature_mismatch'};
}

interface ParsedHeader {
    timestamp: number | null;
    signature: string | null;
}

function parseHeader(header: string): ParsedHeader | null {
    if (!header || typeof header !== 'string') return null;
    let timestamp: number | null = null;
    let signature: string | null = null;
    for (const part of header.split(',')) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf('=');
        if (eq < 0) return null;
        const k = trimmed.slice(0, eq);
        const v = trimmed.slice(eq + 1);
        if (k === 't') {
            const n = Number(v);
            if (!Number.isInteger(n) || n <= 0) return null;
            timestamp = n;
        } else if (k === SIGNATURE_VERSION) {
            signature = v;
        }
    }
    return {timestamp, signature};
}

function constantTimeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
        return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
        return false;
    }
}
