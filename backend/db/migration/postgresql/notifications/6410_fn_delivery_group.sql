--------------UP
-- fn_delivery_group_upsert_and_add_members
-- Atomic find-or-create open group for the given key_hash, then insert
-- member rows for every (alert × endpoint) pair. Returns the group id,
-- a flag for whether it was newly created (caller schedules flush only
-- when new), and the post-insert member count (for storm cap checks).
CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_upsert_and_add_members(
    p_organization_id   VARCHAR,
    p_rule_id           INTEGER,
    p_group_key_hash    BYTEA,
    p_group_key         JSONB,
    p_alert_id          INTEGER,
    p_endpoint_ids      INTEGER[]
)
RETURNS TABLE (
    group_id      BIGINT,
    is_new_group  BOOLEAN,
    member_count  INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_group_id     BIGINT;
    v_is_new       BOOLEAN := FALSE;
    v_inserted     INTEGER := 0;
    v_member_count INTEGER;
BEGIN
    SELECT g.id INTO v_group_id
    FROM notifications.delivery_group g
    WHERE g.group_key_hash = p_group_key_hash
      AND g.state = 'open'
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
    ELSE
        UPDATE notifications.delivery_group
        SET last_alert_at = NOW()
        WHERE id = v_group_id;
    END IF;

    INSERT INTO notifications.delivery_group_member (group_id, alert_id, endpoint_id)
    SELECT v_group_id, p_alert_id, e.endpoint_id
    FROM unnest(p_endpoint_ids) AS e(endpoint_id)
    ON CONFLICT (group_id, alert_id, endpoint_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT COUNT(*)::INTEGER INTO v_member_count
    FROM notifications.delivery_group_member m
    WHERE m.group_id = v_group_id;

    UPDATE notifications.delivery_group
    SET member_count = v_member_count
    WHERE id = v_group_id;

    RETURN QUERY SELECT v_group_id, v_is_new, v_member_count;
END;
$$;

-- fn_delivery_group_flush_load
-- Returns one row per distinct endpoint in the group, each carrying
-- the set of alert ids delivered together. Adapter reads this and
-- renders one multi-alert notification per endpoint.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_flush_load(
    p_group_id BIGINT
)
RETURNS TABLE (
    endpoint_id  INTEGER,
    alert_ids    INTEGER[]
)
LANGUAGE sql
AS $$
    SELECT
        m.endpoint_id,
        ARRAY_AGG(m.alert_id ORDER BY m.added_at ASC) AS alert_ids
    FROM notifications.delivery_group_member m
    WHERE m.group_id = p_group_id
    GROUP BY m.endpoint_id;
$$;

-- fn_delivery_group_mark_notified
-- Records that a flush succeeded and returns whether any members
-- remain active (unresolved). Caller uses the result to decide whether
-- to reschedule at GROUP_INTERVAL_SEC or stop.
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

-- fn_delivery_group_resolve_if_all_resolved
-- Called after an alert resolves. Closes the group if no active alert
-- remains; returns whether the group just transitioned to resolved
-- (caller uses this to schedule one final resolved-notification flush).
CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_resolve_if_all_resolved(
    p_group_id BIGINT
)
RETURNS TABLE (
    group_id      BIGINT,
    just_resolved BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_has_active BOOLEAN;
    v_prev_state TEXT;
BEGIN
    SELECT g.state INTO v_prev_state
    FROM notifications.delivery_group g
    WHERE g.id = p_group_id
    FOR UPDATE;
    IF v_prev_state IS NULL OR v_prev_state = 'resolved' THEN
        RETURN QUERY SELECT p_group_id, FALSE;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM notifications.delivery_group_member m
        JOIN notifications.alert_instances i ON i.id = m.alert_id
        WHERE m.group_id = p_group_id
          AND i.state IN ('active','acknowledged')
    ) INTO v_has_active;

    IF v_has_active THEN
        RETURN QUERY SELECT p_group_id, FALSE;
        RETURN;
    END IF;

    UPDATE notifications.delivery_group
    SET state = 'resolved', resolved_at = NOW()
    WHERE id = p_group_id;
    RETURN QUERY SELECT p_group_id, TRUE;
END;
$$;

-- fn_delivery_group_repeat_due
-- Repeat-interval sweep. Returns open groups that haven't been
-- notified recently enough and still have active members. Caller
-- enqueues one flush per row.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_repeat_due(
    p_threshold_seconds INTEGER
)
RETURNS TABLE (
    group_id BIGINT
)
LANGUAGE sql
AS $$
    SELECT g.id
    FROM notifications.delivery_group g
    WHERE g.state = 'flushed'
      AND g.last_notified_at IS NOT NULL
      AND NOW() - g.last_notified_at >= MAKE_INTERVAL(secs => p_threshold_seconds)
      AND EXISTS (
          SELECT 1
          FROM notifications.delivery_group_member m
          JOIN notifications.alert_instances i ON i.id = m.alert_id
          WHERE m.group_id = g.id
            AND i.state IN ('active','acknowledged')
      );
$$;

-- fn_delivery_group_list_open
-- Admin debug helper used by Admin.ListOpenAlertGroups.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_list_open(
    p_organization_id VARCHAR,
    p_limit           INTEGER DEFAULT 100
)
RETURNS TABLE (
    id               BIGINT,
    rule_id          INTEGER,
    group_key        JSONB,
    first_alert_at   TIMESTAMPTZ,
    last_alert_at    TIMESTAMPTZ,
    last_notified_at TIMESTAMPTZ,
    state            TEXT,
    member_count     INTEGER
)
LANGUAGE sql
AS $$
    SELECT
        g.id,
        g.rule_id,
        g.group_key,
        g.first_alert_at,
        g.last_alert_at,
        g.last_notified_at,
        g.state,
        g.member_count
    FROM notifications.delivery_group g
    WHERE g.organization_id = p_organization_id
      AND g.state IN ('open','flushed')
    ORDER BY g.first_alert_at DESC
    LIMIT p_limit;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_list_open(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_repeat_due(INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_resolve_if_all_resolved(BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_mark_notified(BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_flush_load(BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_delivery_group_upsert_and_add_members(
    VARCHAR, INTEGER, BYTEA, JSONB, INTEGER, INTEGER[]
);
