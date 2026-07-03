import log4js from 'log4js';
import * as auditLog from '../AuditLogger';
import {clearUserinfoCache} from '../user/cache';
import {evictUserSessionEverywhere} from '../user/evictUserSession';
import {
    activeKeys,
    zitadelGrantSigningKey,
    zitadelGrantSigningKeyPrevious
} from './config';
import {
    type RawRequestLike,
    verifyZitadelWebhook,
    type WebhookOutcome
} from './webhook';

const logger = log4js.getLogger('zitadel-actions');

export type GrantRemovedOutcome = WebhookOutcome;

// user.grant.{removed,cascade.removed} → clear userinfo cache + V2 shape.
export async function handleGrantRemoved(
    req: RawRequestLike
): Promise<GrantRemovedOutcome> {
    const signingKeys = activeKeys(
        await zitadelGrantSigningKey(),
        await zitadelGrantSigningKeyPrevious()
    );
    const result = await verifyZitadelWebhook(
        req,
        'user.grant.removed',
        signingKeys
    );
    if ('outcome' in result) return result.outcome;
    const {userId} = result.verified;
    const counts = invalidateUserCacheAndSessions(userId);
    auditGrantRemoved(userId, counts, req.ip);
    return {status: 200, body: {ok: true, ...counts}};
}

// Cache is token-hash-keyed, so all-or-nothing; sessions are per-user.
function invalidateUserCacheAndSessions(userId: string): {
    usersEvicted: number;
    sessionsRefreshed: number;
} {
    clearUserinfoCache();
    return evictUserSessionEverywhere(userId, 'grantRemoved');
}

function auditGrantRemoved(
    userId: string,
    counts: {usersEvicted: number; sessionsRefreshed: number},
    ip: string | undefined
): void {
    void auditLog.log({
        eventType: 'authz_grant_revoked',
        username: userId,
        method: 'user.grant.removed',
        params: {userId, ...counts},
        success: true,
        ipAddress: ip
    });
    logger.info(
        'Zitadel grant change for %s — evicted %d user_t entr(ies), refreshed %d live session(s)',
        userId,
        counts.usersEvicted,
        counts.sessionsRefreshed
    );
}
