import log4js from 'log4js';
import * as Observability from '../Observability';
import {type QueryTxClient, withQueryTransaction} from '../PostgresProvider';
import {
    activeKeys,
    zitadelGdprSigningKey,
    zitadelGdprSigningKeyPrevious
} from './config';
import {enqueueZitadelAction} from './inbox';
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
    const {eventKey, userId, parsed} = result.verified;

    try {
        const queued = await enqueueZitadelAction({
            eventKey,
            action: 'user.removed',
            userId,
            payload: parsed,
            sourceIp: req.ip
        });
        Observability.incrementLabeledCounter(
            queued.inserted
                ? 'zitadel_webhook_enqueued_total'
                : 'zitadel_webhook_duplicate_total',
            {action: 'user.removed'}
        );
        return {status: 200, body: {ok: true, queued: queued.inserted}};
    } catch (err) {
        logger.error('Failed to persist user removal for %s: %s', userId, err);
        return {status: 503, body: {error: 'callback persistence failed'}};
    }
}

export async function processUserRemoved(
    userId: string,
    parsed: unknown,
    ip?: string
): Promise<void> {
    const username = extractUsername(parsed);
    try {
        const cascade = await runCascade(userId, username);
        // V-6: drop cached identity + force live WS sessions to re-auth +
        // notify peers. Without this a deleted user's still-valid token
        // keeps working until the introspection cache naturally TTLs.
        const {evictUserSessionEverywhere} = await import(
            '../user/evictUserSession.js'
        );
        evictUserSessionEverywhere(userId, 'user.removed', {
            disconnect: true,
            reason: 'user-deleted'
        });
        void import('../AuditLogger.js').then((auditLog) =>
            auditLog.log({
                eventType: 'user_gdpr_erasure',
                username: 'zitadel-action',
                method: 'user.removed',
                params: {
                    assignmentsDeleted: cascade.assignmentsDeleted,
                    membershipsDeleted: cascade.membershipsDeleted,
                    personalRowsDeleted: cascade.personalRowsDeleted,
                    ownerRefsCleared: cascade.ownerRefsCleared,
                    historyRowsAnonymized: cascade.historyRowsAnonymized,
                    auditRowsAnonymized: cascade.auditRowsAnonymized,
                    userListRowDropped: cascade.userListRowDropped
                },
                success: true,
                ipAddress: ip
            })
        );
        logger.warn(
            'GDPR erasure for %s — assignments:%d memberships:%d personal:%d audit:%d',
            userId,
            cascade.assignmentsDeleted,
            cascade.membershipsDeleted,
            cascade.personalRowsDeleted,
            cascade.auditRowsAnonymized
        );
    } catch (err) {
        logger.error('GDPR cascade failed for %s: %s', userId, err);
        void import('../AuditLogger.js').then((auditLog) =>
            auditLog.log({
                eventType: 'webhook_failure',
                username: username ?? userId,
                method: 'user.removed',
                params: {userId},
                success: false,
                errorMessage: String(err),
                ipAddress: ip
            })
        );
        throw err;
    }
}

interface CascadeResult {
    assignmentsDeleted: number;
    membershipsDeleted: number;
    personalRowsDeleted: number;
    ownerRefsCleared: number;
    historyRowsAnonymized: number;
    auditRowsAnonymized: number;
    userListRowDropped: number;
}

type QueryRows = QueryTxClient['query'];

// A caller-supplied queryRows must run inside an open transaction (fence lock).
export async function runCascade(
    userId: string,
    username: string | null,
    queryRows?: QueryRows
): Promise<CascadeResult> {
    if (queryRows) return eraseUser(userId, username, queryRows);
    return withQueryTransaction((tx) =>
        eraseUser(userId, username, (sql, params) => tx.query(sql, params))
    );
}

async function eraseUser(
    userId: string,
    username: string | null,
    execute: QueryRows
): Promise<CascadeResult> {
    // Own statement, so the erasure's snapshot sees inserts that held the lock.
    await execute(AUDIT_ACTOR_FENCE_SQL, [userId, username]);
    const rows = await execute<{
        assignments_deleted: number;
        memberships_deleted: number;
        personal_rows_deleted: number;
        owner_refs_cleared: number;
        history_rows_anonymized: number;
        audit_rows_anonymized: number;
        user_list_row_dropped: number;
    }>(USER_ERASURE_SQL, [userId, username]);
    const row = rows[0];
    if (!row) throw new Error('user erasure returned no result');
    return {
        assignmentsDeleted: Number(row.assignments_deleted),
        membershipsDeleted: Number(row.memberships_deleted),
        personalRowsDeleted: Number(row.personal_rows_deleted),
        ownerRefsCleared: Number(row.owner_refs_cleared),
        historyRowsAnonymized: Number(row.history_rows_anonymized),
        auditRowsAnonymized: Number(row.audit_rows_anonymized),
        userListRowDropped: Number(row.user_list_row_dropped)
    };
}

const AUDIT_ACTOR_FENCE_SQL =
    'SELECT logging.fn_audit_actor_fence($1::VARCHAR, $2::VARCHAR)';

const USER_ERASURE_SQL = `
WITH
deleted_assignments AS (
    DELETE FROM organization.assignments
     WHERE subject_type = 'user' AND subject_id = $1
     RETURNING 1
),
deleted_memberships AS (
    DELETE FROM organization.user_group_memberships WHERE user_id = $1 RETURNING 1
),
deleted_scoped_pats AS (
    DELETE FROM organization.fm_scoped_pats WHERE user_id = $1 RETURNING 1
),
deleted_service_tokens AS (
    DELETE FROM organization.service_user_token_meta WHERE user_id = $1 RETURNING 1
),
deleted_pat_schedules AS (
    DELETE FROM organization.pat_revoke_schedule WHERE user_id = $1 RETURNING 1
),
deleted_scoped_tokens AS (
    DELETE FROM organization.scoped_token
     WHERE issued_by = $1 OR ($2::TEXT IS NOT NULL AND issued_by = $2)
     RETURNING 1
),
deleted_notification_tokens AS (
    DELETE FROM notifications.tokens WHERE user_id = $1 RETURNING 1
),
deleted_inbox AS (
    DELETE FROM notifications.inbox_items WHERE user_id = $1 RETURNING 1
),
deleted_digest AS (
    DELETE FROM notifications.notification_digest_items WHERE user_id = $1 RETURNING 1
),
deleted_preferences AS (
    DELETE FROM notifications.user_notification_preferences WHERE user_id = $1 RETURNING 1
),
deleted_push_tokens AS (
    DELETE FROM notifications.push_tokens WHERE user_id = $1 RETURNING 1
),
deleted_destinations AS (
    DELETE FROM notifications.destination_group_members
     WHERE member_type = 'user' AND member_id = $1 RETURNING 1
),
deleted_dashboard_pins AS (
    DELETE FROM ui.dashboard_pin WHERE user_id = $1 RETURNING 1
),
deleted_dashboard_order AS (
    DELETE FROM ui.dashboard_order_user WHERE user_id = $1 RETURNING 1
),
deleted_export_tickets AS (
    DELETE FROM logging.audit_export_tickets
     WHERE user_id = $1
       AND filename NOT IN (
           SELECT filename FROM logging.audit_exports WHERE owner_id = $1
       )
     RETURNING 1
),
deleted_exports AS (
    DELETE FROM logging.audit_exports WHERE owner_id = $1 RETURNING 1
),
cleared_dashboard_owners AS (
    UPDATE ui.dashboard SET owner_user_id = NULL WHERE owner_user_id = $1 RETURNING 1
),
cleared_alert_owners AS (
    UPDATE notifications.alert_rules SET owner_user_id = NULL WHERE owner_user_id = $1 RETURNING 1
),
cleared_template_authors AS (
    UPDATE notifications.alert_rule_templates SET author_user_id = NULL WHERE author_user_id = $1 RETURNING 1
),
cleared_alert_acknowledgements AS (
    UPDATE notifications.alert_instances
       SET acknowledged_by_user_id = NULL, acknowledged_by_display_name = NULL
     WHERE acknowledged_by_user_id = $1 RETURNING 1
),
cleared_dashboard_history AS (
    UPDATE ui.dashboard_activity_log SET actor_user_id = NULL WHERE actor_user_id = $1 RETURNING 1
),
anonymized_alert_transitions AS (
    UPDATE notifications.alert_transitions
       SET actor_user_id = '<deleted-user>', actor_display_name = NULL
     WHERE actor_user_id = $1 RETURNING 1
),
anonymized_alert_annotations AS (
    UPDATE notifications.alert_annotations
       SET author_user_id = '<deleted-user>', author_display_name = NULL
     WHERE author_user_id = $1 RETURNING 1
),
anonymized_authz_audit AS (
    UPDATE organization.authz_audit SET actor_id = '<deleted-user>'
     WHERE actor_id = $1 OR ($2::TEXT IS NOT NULL AND actor_id = $2) RETURNING 1
),
anonymized_assignment_creators AS (
    UPDATE organization.assignments SET created_by = '<deleted-user>'
     WHERE NOT (subject_type = 'user' AND subject_id = $1)
       AND (created_by = $1 OR ($2::TEXT IS NOT NULL AND created_by = $2))
     RETURNING 1
),
anonymized_membership_creators AS (
    UPDATE organization.user_group_memberships SET added_by = '<deleted-user>'
     WHERE user_id <> $1
       AND (added_by = $1 OR ($2::TEXT IS NOT NULL AND added_by = $2))
     RETURNING 1
),
anonymized_pat_creators AS (
    UPDATE organization.fm_scoped_pats SET created_by = '<deleted-user>'
     WHERE user_id <> $1
       AND (created_by = $1 OR ($2::TEXT IS NOT NULL AND created_by = $2))
     RETURNING 1
),
anonymized_audit AS (
    UPDATE logging.audit_log
       SET username = '<deleted-user>', actor_user_id = NULL
     WHERE actor_user_id = $1
        OR ($2::TEXT IS NOT NULL AND actor_user_id IS NULL AND username = $2)
     RETURNING 1
),
deleted_legacy_user AS (
    DELETE FROM "user".list WHERE $2::TEXT IS NOT NULL AND name = $2 RETURNING 1
)
SELECT
    (SELECT count(*) FROM deleted_assignments)::INT AS assignments_deleted,
    (SELECT count(*) FROM deleted_memberships)::INT AS memberships_deleted,
    ((SELECT count(*) FROM deleted_scoped_pats)
      + (SELECT count(*) FROM deleted_service_tokens)
      + (SELECT count(*) FROM deleted_pat_schedules)
      + (SELECT count(*) FROM deleted_scoped_tokens)
      + (SELECT count(*) FROM deleted_notification_tokens)
      + (SELECT count(*) FROM deleted_inbox)
      + (SELECT count(*) FROM deleted_digest)
      + (SELECT count(*) FROM deleted_preferences)
      + (SELECT count(*) FROM deleted_push_tokens)
      + (SELECT count(*) FROM deleted_destinations)
      + (SELECT count(*) FROM deleted_dashboard_pins)
      + (SELECT count(*) FROM deleted_dashboard_order)
      + (SELECT count(*) FROM deleted_export_tickets)
      + (SELECT count(*) FROM deleted_exports))::INT AS personal_rows_deleted,
    ((SELECT count(*) FROM cleared_dashboard_owners)
      + (SELECT count(*) FROM cleared_alert_owners)
      + (SELECT count(*) FROM cleared_template_authors)
      + (SELECT count(*) FROM cleared_alert_acknowledgements))::INT AS owner_refs_cleared,
    ((SELECT count(*) FROM cleared_dashboard_history)
      + (SELECT count(*) FROM anonymized_alert_transitions)
      + (SELECT count(*) FROM anonymized_alert_annotations)
      + (SELECT count(*) FROM anonymized_authz_audit)
      + (SELECT count(*) FROM anonymized_assignment_creators)
      + (SELECT count(*) FROM anonymized_membership_creators)
      + (SELECT count(*) FROM anonymized_pat_creators))::INT AS history_rows_anonymized,
    (SELECT count(*) FROM anonymized_audit)::INT AS audit_rows_anonymized,
    (SELECT count(*) FROM deleted_legacy_user)::INT AS user_list_row_dropped`;
