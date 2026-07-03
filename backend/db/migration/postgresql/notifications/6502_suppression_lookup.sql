--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_notification_suppression_active_list(
    p_organization_id VARCHAR,
    p_channel_type    VARCHAR,
    p_recipients      VARCHAR[]
)
RETURNS TABLE (
    recipient VARCHAR,
    reason    VARCHAR
)
LANGUAGE sql
AS $$
    SELECT s.recipient, s.reason
    FROM notifications.notification_suppressions s
    WHERE s.organization_id = p_organization_id
      AND s.channel_type = p_channel_type
      AND s.active = TRUE
      AND s.recipient_key = ANY (
          SELECT LOWER(TRIM(value))
          FROM UNNEST(COALESCE(p_recipients, ARRAY[]::VARCHAR[])) AS value
          WHERE TRIM(value) <> ''
      )
    ORDER BY s.recipient_key, s.reason;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_notification_suppression_active_list(
    VARCHAR, VARCHAR, VARCHAR[]
);
