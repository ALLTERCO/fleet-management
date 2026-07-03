--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_notification_inbox_mark_all_read(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR
)
RETURNS TABLE (
    updated_count BIGINT
)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE notifications.inbox_items i
        SET state = 'read',
            read_at = NOW()
        WHERE i.organization_id = p_organization_id
          AND i.user_id = p_user_id
          AND i.state <> 'read'
        RETURNING 1
    )
    SELECT COUNT(*)::BIGINT AS updated_count
    FROM updated;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_notification_inbox_mark_all_read;
