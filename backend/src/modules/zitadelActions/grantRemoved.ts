import log4js from 'log4js';
import * as Observability from '../Observability';
import type {EvictOptions} from '../user/evictUserSession';
import {
    activeKeys,
    zitadelGrantSigningKey,
    zitadelGrantSigningKeyPrevious
} from './config';
import {ZITADEL_USER_EVENTS} from './eventNames';
import {extractUserId} from './extractUserId';
import {enqueueZitadelAction} from './inbox';
import {
    type RawRequestLike,
    requireWebhookUser,
    type SignedWebhook,
    verifySignedZitadelBody,
    type WebhookOutcome
} from './webhook';

const logger = log4js.getLogger('zitadel-actions');

export type GrantRemovedOutcome = WebhookOutcome;

// Eviction makes the account check refuse their credentials now; drop live sockets too.
const ACCOUNT_STOP_EVENTS: ReadonlySet<string> = new Set([
    ZITADEL_USER_EVENTS.deactivated,
    ZITADEL_USER_EVENTS.locked
]);

/** The Zitadel event type of a callback body, when it names one. */
export function zitadelEventType(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const eventType = (payload as {event_type?: unknown}).event_type;
    return typeof eventType === 'string' && eventType ? eventType : null;
}

// No payload and the grant as aggregate: no user to evict; user.removed covers it.
const USERLESS_EVENTS: ReadonlySet<string> = new Set([
    ZITADEL_USER_EVENTS.grantCascadeRemoved
]);

function evictionFor(eventType: string | null): EvictOptions {
    return eventType && ACCOUNT_STOP_EVENTS.has(eventType)
        ? {disconnect: true, reason: eventType}
        : {};
}

// user.grant.* and user.{deactivated,locked} → clear userinfo cache + V2 shape.
export async function handleGrantRemoved(
    req: RawRequestLike
): Promise<GrantRemovedOutcome> {
    const signingKeys = activeKeys(
        await zitadelGrantSigningKey(),
        await zitadelGrantSigningKeyPrevious()
    );
    const result = await verifySignedZitadelBody(
        req,
        'user.grant.removed',
        signingKeys
    );
    if ('outcome' in result) return result.outcome;
    if (namesNoUser(result.signed)) return acknowledgeUserless(result.signed);
    const subject = requireWebhookUser('user.grant.removed', result.signed);
    if ('outcome' in subject) return subject.outcome;
    const {eventKey, userId, parsed} = subject.verified;
    try {
        const queued = await enqueueZitadelAction({
            eventKey,
            action: 'user.grant.removed',
            userId,
            payload: parsed,
            sourceIp: req.ip
        });
        Observability.incrementLabeledCounter(
            queued.inserted
                ? 'zitadel_webhook_enqueued_total'
                : 'zitadel_webhook_duplicate_total',
            {action: 'user.grant.removed'}
        );
        return {status: 200, body: {ok: true, queued: queued.inserted}};
    } catch (err) {
        logger.error(
            'Failed to persist grant callback for %s: %s',
            userId,
            err
        );
        return {status: 503, body: {error: 'callback persistence failed'}};
    }
}

function namesNoUser(signed: SignedWebhook): boolean {
    const eventType = zitadelEventType(signed.parsed);
    return (
        eventType !== null &&
        USERLESS_EVENTS.has(eventType) &&
        extractUserId(signed.parsed) === null
    );
}

function acknowledgeUserless(signed: SignedWebhook): GrantRemovedOutcome {
    const aggregate = (signed.parsed as {aggregateID?: unknown}).aggregateID;
    logger.info(
        '%s for grant %s names no user; nothing to evict',
        zitadelEventType(signed.parsed),
        typeof aggregate === 'string' ? aggregate : 'unknown'
    );
    return {status: 200, body: {ok: true, queued: false}};
}

export async function processGrantRemoved(
    userId: string,
    ip?: string,
    payload?: unknown
): Promise<void> {
    const [{clearUserinfoCache}, {evictUserSessionEverywhere}] =
        await Promise.all([
            import('../user/cache.js'),
            import('../user/evictUserSession.js')
        ]);
    clearUserinfoCache();
    const eventType = zitadelEventType(payload);
    const counts = evictUserSessionEverywhere(
        userId,
        'grantRemoved',
        evictionFor(eventType)
    );
    auditGrantRemoved(userId, counts, {ip, eventType});
}

function auditGrantRemoved(
    userId: string,
    counts: {usersEvicted: number; sessionsRefreshed: number},
    source: {ip: string | undefined; eventType: string | null}
): void {
    const {ip, eventType} = source;
    void import('../AuditLogger.js').then((auditLog) =>
        auditLog.log({
            eventType: 'authz_grant_revoked',
            username: userId,
            method: eventType ?? 'user.grant.removed',
            params: {userId, ...counts},
            success: true,
            ipAddress: ip
        })
    );
    logger.info(
        'Zitadel grant change for %s — evicted %d user_t entr(ies), refreshed %d live session(s)',
        userId,
        counts.usersEvicted,
        counts.sessionsRefreshed
    );
}
