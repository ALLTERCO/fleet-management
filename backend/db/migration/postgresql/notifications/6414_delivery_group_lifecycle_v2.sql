--------------UP
-- Bug 2 fix: after a flush, the group transitioned to state='flushed'
-- and the upsert searched only for state='open', so follow-on alerts
-- created a NEW group instead of accumulating in the original.
-- Alertmanager keeps the group alive through group_interval until
-- all members resolve.
--
-- New lifecycle:
--   open     — no flush sent yet, accumulating for group_wait
--   flushed  — at least one flush sent, still has unresolved members,
--              accumulating for group_interval
--   resolved — all members resolved, closed
--
-- Upsert searches open+flushed. Only fn_delivery_group_resolve_if_all_resolved
-- transitions out. Unique index covers unresolved rows only.

DROP INDEX IF EXISTS notifications.delivery_group_open_key;
CREATE UNIQUE INDEX delivery_group_unresolved_key
    ON notifications.delivery_group (group_key_hash)
    WHERE state IN ('open','flushed');

DROP FUNCTION IF EXISTS notifications.fn_delivery_group_upsert_and_add_members(
    VARCHAR, INTEGER, BYTEA, JSONB, INTEGER, INTEGER[]
);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_upsert_and_add_members(
    p_organization_id   VARCHAR,
    p_rule_id           INTEGER,
    p_group_key_hash    BYTEA,
    p_group_key         JSONB,
    p_alert_id          INTEGER,
    p_endpoint_ids      INTEGER[]
)
RETURNS TABLE (
    group_id         BIGINT,
    is_new_group     BOOLEAN,
    is_first_flush   BOOLEAN,
    member_count     INTEGER,
    last_notified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_group_id         BIGINT;
    v_is_new           BOOLEAN := FALSE;
    v_is_first_flush   BOOLEAN := FALSE;
    v_state            TEXT;
    v_member_count     INTEGER;
    v_last_notified_at TIMESTAMPTZ;
BEGIN
    SELECT g.id, g.state, g.last_notified_at
    INTO v_group_id, v_state, v_last_notified_at
    FROM notifications.delivery_group g
    WHERE g.group_key_hash = p_group_key_hash
      AND g.state IN ('open','flushed')
    FOR UPDATE;

    IF v_group_id IS NULL THEN
        INSERT INTO notifications.delivery_group (
            organization_id, rule_id, group_key_hash, group_key
        )
        VALUES (
            p_organization_id, p_rule_id, p_group_key_hash, p_group_key
        )
        RETURNING id INTO v_group_id;
        v_is_new := TRUE;
        v_is_first_flush := TRUE;
    ELSE
        UPDATE notifications.delivery_group
        SET last_alert_at = NOW()
        WHERE id = v_group_id;
        v_is_first_flush := (v_state = 'open');
    END IF;

    INSERT INTO notifications.delivery_group_member (group_id, alert_id, endpoint_id)
    SELECT v_group_id, p_alert_id, e.endpoint_id
    FROM unnest(p_endpoint_ids) AS e(endpoint_id)
    ON CONFLICT (group_id, alert_id, endpoint_id) DO NOTHING;

    SELECT COUNT(*)::INTEGER INTO v_member_count
    FROM notifications.delivery_group_member m
    WHERE m.group_id = v_group_id;

    UPDATE notifications.delivery_group
    SET member_count = v_member_count
    WHERE id = v_group_id;

    RETURN QUERY SELECT
        v_group_id, v_is_new, v_is_first_flush, v_member_count,
        v_last_notified_at;
END;
$$;

-- mark_notified: transition open→flushed on first flush; later flushes
-- leave state='flushed' (the group stays alive until all members resolve).
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_mark_notified(BIGINT);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_mark_notified(
    p_group_id BIGINT
)
RETURNS TABLE (
    group_id           BIGINT,
    has_active_members BOOLEAN,
    member_count       INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_has_active BOOLEAN;
    v_count      INTEGER;
BEGIN
    UPDATE notifications.delivery_group g
    SET last_notified_at = NOW(),
        state = CASE WHEN g.state = 'open' THEN 'flushed' ELSE g.state END
    WHERE g.id = p_group_id;

    SELECT COUNT(*)::INTEGER INTO v_count
    FROM notifications.delivery_group_member m
    WHERE m.group_id = p_group_id;

    SELECT EXISTS (
        SELECT 1
        FROM notifications.delivery_group_member m
        JOIN notifications.alert_instances i ON i.id = m.alert_id
        WHERE m.group_id = p_group_id
          AND i.state IN ('active','acknowledged')
    ) INTO v_has_active;

    RETURN QUERY SELECT p_group_id, v_has_active, v_count;
END;
$$;

--------------DOWN
DROP INDEX IF EXISTS notifications.delivery_group_unresolved_key;
CREATE UNIQUE INDEX delivery_group_open_key
    ON notifications.delivery_group (group_key_hash)
    WHERE state = 'open';
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_upsert_and_add_members(
    VARCHAR, INTEGER, BYTEA, JSONB, INTEGER, INTEGER[]
);
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_mark_notified(BIGINT);
