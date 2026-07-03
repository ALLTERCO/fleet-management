--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_user_notification_preference_filter(
    p_organization_id VARCHAR,
    p_user_ids         VARCHAR[],
    p_channel_type     VARCHAR,
    p_severity         VARCHAR
)
RETURNS TABLE (user_id VARCHAR)
LANGUAGE sql
AS $$
    WITH candidate_users AS (
        SELECT DISTINCT value AS user_id
        FROM UNNEST(COALESCE(p_user_ids, ARRAY[]::VARCHAR[])) AS value
        WHERE TRIM(value) <> ''
    )
    SELECT c.user_id
    FROM candidate_users c
    LEFT JOIN notifications.user_notification_preferences p
      ON p.organization_id = p_organization_id
     AND p.user_id = c.user_id
     AND p.channel_type = p_channel_type
    WHERE p.user_id IS NULL
       OR (
            p.disabled = FALSE
        AND (p.severity_filters ? p_severity)
       )
    ORDER BY c.user_id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_user_notification_preference_filter(
    VARCHAR, VARCHAR[], VARCHAR, VARCHAR
);
