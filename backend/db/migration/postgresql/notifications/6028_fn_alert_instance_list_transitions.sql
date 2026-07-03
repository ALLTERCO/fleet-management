--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_list_transitions(
    p_alert_id  INTEGER,
    p_limit     INTEGER DEFAULT 200,
    p_offset    INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count         BIGINT,
    created_at          TIMESTAMPTZ,
    action              VARCHAR,
    actor_user_id       VARCHAR,
    actor_display_name  VARCHAR,
    data                JSONB
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM notifications.alert_transitions t
        WHERE t.alert_id = p_alert_id
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        t.created_at,
        t.action,
        t.actor_user_id,
        t.actor_display_name,
        t.data
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY created_at DESC, id DESC
        LIMIT p_limit OFFSET p_offset
    ) t ON TRUE;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_instance_list_transitions;
