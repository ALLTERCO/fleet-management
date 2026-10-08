// Shared preamble for Zitadel action webhooks: config + signature + body +
// userId checks. Returns either a failure outcome to send as-is, or the
// verified payload. One home so every action handler verifies identically.

import log4js from 'log4js';
import {zitadelActionReplaySkewMs} from './config';
import {extractUserId} from './extractUserId';
import {
    verifyZitadelSignatureMulti,
    zitadelSignatureReplayKey
} from './signature';

const logger = log4js.getLogger('zitadel-actions');
const ZITADEL_SIGNATURE_HEADERS = [
    'x-zitadel-signature',
    'zitadel-signature'
] as const;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function auditFailure(
    method: string,
    reason: string,
    ipAddress?: string
): void {
    void import('../AuditLogger.js').then((auditLog) =>
        auditLog.log({
            eventType: 'webhook_failure',
            method,
            params: {reason},
            success: false,
            errorMessage: reason,
            ipAddress
        })
    );
}

export interface WebhookOutcome {
    status: number;
    body: unknown;
}

export interface RawRequestLike {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | undefined;
    ip?: string;
}

export interface SignedWebhook {
    eventKey: string;
    parsed: unknown;
    rawBody: Buffer;
}

export interface VerifiedWebhook extends SignedWebhook {
    userId: string;
}

function readSignatureHeader(req: RawRequestLike): string | undefined {
    for (const header of ZITADEL_SIGNATURE_HEADERS) {
        const v = req.headers[header];
        // Node turns duplicate headers into arrays; Zitadel sends one signature.
        const signature = Array.isArray(v) ? v[0] : v;
        if (signature) return signature;
    }
    return undefined;
}

/** Checks config, signature, replay key and JSON; not who the event is about. */
export async function verifySignedZitadelBody(
    req: RawRequestLike,
    method: string,
    signingKeys: string[]
): Promise<{outcome: WebhookOutcome} | {signed: SignedWebhook}> {
    if (signingKeys.length === 0) {
        return {
            outcome: {status: 503, body: {error: 'webhook not configured'}}
        };
    }
    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
        return {outcome: {status: 400, body: {error: 'empty body'}}};
    }
    const signatureHeader = readSignatureHeader(req);
    const verify = verifyZitadelSignatureMulti({
        rawBody,
        signatureHeader,
        signingKeys,
        skewMs: zitadelActionReplaySkewMs()
    });
    if (!verify.ok) {
        logger.warn('%s signature rejected: %s', method, verify.reason);
        auditFailure(method, `signature:${verify.reason}`, req.ip);
        return {outcome: {status: 401, body: {error: 'invalid signature'}}};
    }
    const replayKey = zitadelSignatureReplayKey(signatureHeader);
    if (!replayKey) {
        return {outcome: {status: 401, body: {error: 'invalid signature'}}};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return {outcome: {status: 400, body: {error: 'invalid json'}}};
    }
    return {signed: {eventKey: `${method}:${replayKey}`, parsed, rawBody}};
}

/** Names the user a signed event is about, or refuses the event. */
export function requireWebhookUser(
    method: string,
    signed: SignedWebhook
): {outcome: WebhookOutcome} | {verified: VerifiedWebhook} {
    const userId = extractUserId(signed.parsed);
    if (!userId || !USER_ID_PATTERN.test(userId)) {
        logger.warn('%s missing or malformed userId', method);
        return {outcome: {status: 400, body: {error: 'bad user id'}}};
    }
    return {verified: {...signed, userId}};
}

export async function verifyZitadelWebhook(
    req: RawRequestLike,
    method: string,
    signingKeys: string[]
): Promise<{outcome: WebhookOutcome} | {verified: VerifiedWebhook}> {
    const result = await verifySignedZitadelBody(req, method, signingKeys);
    if ('outcome' in result) return result;
    return requireWebhookUser(method, result.signed);
}
