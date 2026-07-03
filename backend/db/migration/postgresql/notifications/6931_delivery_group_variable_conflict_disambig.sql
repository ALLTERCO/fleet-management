--------------UP
-- Same plpgsql OUT-param-vs-column ambiguity fixed in 6926/6927.
-- RETURNS TABLE exposes group_id; the delivery_group_member upsert also uses
-- group_id, so plpgsql.variable_conflict=error can abort alert dispatch.
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
#variable_conflict use_column
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

--------------DOWN
-- No-op: reverting would reintroduce alert dispatch failures.
