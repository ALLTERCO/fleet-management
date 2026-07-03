--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_transition_append(
    p_alert_id             INTEGER,
    p_action               VARCHAR,
    p_actor_user_id        VARCHAR DEFAULT NULL,
    p_actor_display_name   VARCHAR DEFAULT NULL,
    p_data                 JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id                  INTEGER,
    alert_id            INTEGER,
    action              VARCHAR,
    actor_user_id       VARCHAR,
    actor_display_name  VARCHAR,
    data                JSONB,
    created_at          TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.alert_transitions (
        alert_id,
        action,
        actor_user_id,
        actor_display_name,
        data
    )
    VALUES (
        p_alert_id,
        p_action,
        p_actor_user_id,
        p_actor_display_name,
        COALESCE(p_data, '{}'::jsonb)
    )
    RETURNING
        id,
        alert_id,
        action,
        actor_user_id,
        actor_display_name,
        data,
        created_at;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_transition_append;
