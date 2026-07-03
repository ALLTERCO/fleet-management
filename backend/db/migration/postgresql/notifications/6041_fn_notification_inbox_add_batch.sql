--------------UP
-- Bulk-insert inbox items for a set of recipient users on one alert
-- transition. Skips duplicates per (user_id, alert_id, kind) so the
-- engine can re-invoke safely on retried transitions without spamming
-- the inbox. Returns the inserted rows.
CREATE OR REPLACE FUNCTION notifications.fn_notification_inbox_add_batch(
    p_organization_id   VARCHAR,
    p_user_ids          VARCHAR[],
    p_kind              VARCHAR,
    p_alert_id          INTEGER,
    p_subject_type      VARCHAR,
    p_subject_id        VARCHAR,
    p_title             VARCHAR,
    p_message           TEXT,
    p_available_actions JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    user_id         VARCHAR,
    kind            VARCHAR,
    state           VARCHAR,
    alert_id        INTEGER,
    created_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH recipients AS (
        SELECT DISTINCT unnest(p_user_ids) AS user_id
    )
    INSERT INTO notifications.inbox_items (
        organization_id, user_id, kind, state, alert_id,
        source_subject_type, source_subject_id,
        title, message, available_actions
    )
    SELECT
        p_organization_id, r.user_id, p_kind, 'unread', p_alert_id,
        p_subject_type, p_subject_id,
        p_title, p_message, p_available_actions
    FROM recipients r
    WHERE NOT EXISTS (
        SELECT 1
        FROM notifications.inbox_items i
        WHERE i.organization_id = p_organization_id
          AND i.user_id = r.user_id
          AND i.alert_id = p_alert_id
          AND i.kind = p_kind
    )
    RETURNING id, organization_id, user_id, kind, state, alert_id, created_at;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_notification_inbox_add_batch;
