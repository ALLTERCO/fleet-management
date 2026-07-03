--------------UP
-- Same race fix as organization/6005 (fn_profile_ensure): per-alert advisory lock.
DROP FUNCTION IF EXISTS notifications.fn_notification_inbox_add_batch(
    VARCHAR, VARCHAR[], VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB
);

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
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtext('fn_inbox_add_batch:' || p_alert_id::text)
    );

    RETURN QUERY
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
    RETURNING
        notifications.inbox_items.id,
        notifications.inbox_items.organization_id,
        notifications.inbox_items.user_id,
        notifications.inbox_items.kind,
        notifications.inbox_items.state,
        notifications.inbox_items.alert_id,
        notifications.inbox_items.created_at;
END;
$$;
--------------DOWN
-- Restore the unlocked 6041 body.
DROP FUNCTION IF EXISTS notifications.fn_notification_inbox_add_batch(
    VARCHAR, VARCHAR[], VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB
);

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
