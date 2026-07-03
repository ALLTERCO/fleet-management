// Shared preamble for Zitadel action webhooks: config + signature + body +
// userId checks. Returns either a failure outcome to send as-is, or the
// verified payload. One home so every action handler verifies identically.

import log4js from 'log4js';
import * as auditLog from '../AuditLogger';
import * as Observability from '../Observability';
import {reservation} from '../redis/services';
import {zitadelActionReplaySkewMs} from './config';
import {extractUserId} from './extractUserId';
import {
    verifyZitadelSignatureMulti,
    zitadelSignatureReplayKey
} from './signature';

const logger = log4js.getLogger('zitadel-actions');
const ZITADEL_SIGNATURE_HEADER = 'zitadel-signature';
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface WebhookOutcome {
    status: number;
    body: unknown;
}

export interface RawRequestLike {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | undefined;
    ip?: string;
}

export interface VerifiedWebhook {
    userId: string;
    parsed: unknown;
    rawBody: Buffer;
}

function readSignatureHeader(req: RawRequestLike): string | undefined {
    const v = req.headers[ZITADEL_SIGNATURE_HEADER];
    // Node turns duplicate headers into arrays; Zitadel sends one signature.
    return Array.isArray(v) ? v[0] : v;
}

export async function verifyZitadelWebhook(
    req: RawRequestLike,
    method: string,
    signingKeys: string[]
): Promise<{outcome: WebhookOutcome} | {verified: VerifiedWebhook}> {
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
        void auditLog.log({
            eventType: 'webhook_failure',
            method,
            params: {reason: `signature:${verify.reason}`},
            success: false,
            errorMessage: verify.reason,
            ipAddress: req.ip
        });
        return {outcome: {status: 401, body: {error: 'invalid signature'}}};
    }
    const replayKey = zitadelSignatureReplayKey(signatureHeader);
    if (!replayKey) {
        return {outcome: {status: 401, body: {error: 'invalid signature'}}};
    }
    const replayTtlSec = Math.max(
        1,
        Math.ceil(zitadelActionReplaySkewMs() / 1000)
    );
    const replayClaim = await reservation.reserve(
        `zitadel-action:${method}:${replayKey}`,
        1,
        replayTtlSec
    );
    if (!replayClaim.ok) {
        Observability.incrementCounter('zitadel_webhook_replay_rejects');
        const error =
            replayClaim.reason === 'backend_error'
                ? 'replay guard unavailable'
                : 'replay detected';
        void auditLog.log({
            eventType: 'webhook_failure',
            method,
            params: {reason: `signature:${error}`},
            success: false,
            errorMessage: error,
            ipAddress: req.ip
        });
        return {
            outcome: {
                status: replayClaim.reason === 'backend_error' ? 503 : 409,
                body: {error}
            }
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return {outcome: {status: 400, body: {error: 'invalid json'}}};
    }
    const userId = extractUserId(parsed);
    if (!userId || !USER_ID_PATTERN.test(userId)) {
        logger.warn('%s missing or malformed userId', method);
        return {outcome: {status: 400, body: {error: 'bad user id'}}};
    }
    return {verified: {userId, parsed, rawBody}};
}
