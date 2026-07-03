import log4js from 'log4js';
import * as auditLog from '../AuditLogger';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {evictUserSessionEverywhere} from '../user/evictUserSession';
import {
    activeKeys,
    zitadelGdprSigningKey,
    zitadelGdprSigningKeyPrevious
} from './config';
import {
    type RawRequestLike,
    verifyZitadelWebhook,
    type WebhookOutcome
} from './webhook';

const logger = log4js.getLogger('zitadel-actions');

export type UserRemovedOutcome = WebhookOutcome;

function extractUsername(parsed: unknown): string | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const root = parsed as Record<string, unknown>;
    const u = root.user as Record<string, unknown> | undefined;
    if (typeof u?.preferred_login_name === 'string' && u.preferred_login_name) {
        return u.preferred_login_name;
    }
    if (typeof u?.username === 'string' && u.username) return u.username;
    return null;
}

export async function handleUserRemoved(
    req: RawRequestLike
): Promise<UserRemovedOutcome> {
    const signingKeys = activeKeys(
        await zitadelGdprSigningKey(),
        await zitadelGdprSigningKeyPrevious()
    );
    const result = await verifyZitadelWebhook(req, 'user.removed', signingKeys);
    if ('outcome' in result) return result.outcome;
    const {userId, parsed} = result.verified;
    const username = extractUsername(parsed);

    try {
        const cascade = await runCascade(userId, username);
        // Username-keyed cleanup (audit_log, user.list) can't run without it;
        // surface the partial erasure loudly instead of silently 200-ing.
        if (!username) {
            Observability.incrementCounter('gdpr_erasure_incomplete');
            logger.error(
                'GDPR erasure incomplete for %s — webhook had no username; audit_log + user.list not anonymized',
                userId
            );
        }
        // V-6: drop cached identity + force live WS sessions to re-auth +
        // notify peers. Without this a deleted user's still-valid token
        // keeps working until the introspection cache naturally TTLs.
        evictUserSessionEverywhere(userId, 'user.removed', {
            disconnect: true,
            reason: 'user-deleted'
        });
        void auditLog.log({
            eventType: 'user_gdpr_erasure',
            username: username ?? userId,
            method: 'user.removed',
            params: {
                userId,
                assignmentsDeleted: cascade.assignmentsDeleted,
                auditRowsAnonymized: cascade.auditRowsAnonymized,
                userListRowDropped: cascade.userListRowDropped
            },
            success: true,
            ipAddress: req.ip
        });
        logger.warn(
            'GDPR erasure for %s — assignments:%d audit:%d cached:%d',
            userId,
            cascade.assignmentsDeleted,
            cascade.auditRowsAnonymized,
            cascade.userListRowDropped
        );
        return {status: 200, body: {ok: true}};
    } catch (err) {
        logger.error('GDPR cascade failed for %s: %s', userId, err);
        void auditLog.log({
            eventType: 'webhook_failure',
            username: username ?? userId,
            method: 'user.removed',
            params: {userId},
            success: false,
            errorMessage: String(err),
            ipAddress: req.ip
        });
        return {status: 500, body: {error: 'cascade failed'}};
    }
}

interface CascadeResult {
    assignmentsDeleted: number;
    auditRowsAnonymized: number;
    userListRowDropped: number;
}

type QueryRows = typeof PostgresProvider.queryRows;

export async function runCascade(
    userId: string,
    username: string | null,
    queryRows: QueryRows = PostgresProvider.queryRows
): Promise<CascadeResult> {
    const assignmentsDeleted = (
        await queryRows<{id: string}>(
            `DELETE FROM organization.assignments
             WHERE subject_type = 'user' AND subject_id = $1
             RETURNING id`,
            [userId]
        )
    ).length;

    let auditRowsAnonymized = 0;
    if (username) {
        auditRowsAnonymized = (
            await queryRows<{id: number}>(
                `UPDATE logging.audit_log
                 SET username = $2
                 WHERE username = $1
                 RETURNING id`,
                [username, `<deleted-${userId}>`]
            )
        ).length;
    }

    let userListRowDropped = 0;
    if (username) {
        userListRowDropped = (
            await queryRows<{id: number}>(
                `DELETE FROM "user".list WHERE name = $1 RETURNING id`,
                [username]
            )
        ).length;
    }

    return {assignmentsDeleted, auditRowsAnonymized, userListRowDropped};
}
