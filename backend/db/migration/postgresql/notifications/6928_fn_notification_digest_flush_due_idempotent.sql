--------------UP
-- Idempotent digest flush: the marked UPDATE gains `AND d.consumed_at IS NULL`
-- so an overlapping second flush updates 0 rows and inserts no duplicate
-- digest. Body otherwise identical to 6512.
CREATE OR REPLACE FUNCTION notifications.fn_notification_digest_flush_due(
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    user_id         VARCHAR,
    kind            VARCHAR,
    state           VARCHAR,
    alert_id        INTEGER
)
LANGUAGE sql
AS $$
    WITH due_groups AS (
        SELECT
            organization_id,
            user_id,
            ARRAY_AGG(id ORDER BY created_at ASC) AS digest_ids,
            COUNT(*) AS item_count,
            MIN(created_at) AS first_at,
            MAX(created_at) AS last_at
        FROM notifications.notification_digest_items
        WHERE consumed_at IS NULL
          AND flush_after <= NOW()
        GROUP BY organization_id, user_id
        ORDER BY MIN(flush_after) ASC
        LIMIT GREATEST(1, COALESCE(p_limit, 100))
    ),
    marked AS (
        UPDATE notifications.notification_digest_items d
        SET consumed_at = NOW()
        FROM due_groups g
        WHERE d.id = ANY(g.digest_ids)
          AND d.consumed_at IS NULL
        RETURNING d.organization_id, d.user_id, d.id
    ),
    inserted AS (
        INSERT INTO notifications.inbox_items (
            organization_id, user_id, kind, state, alert_id,
            source_subject_type, source_subject_id, title, message,
            available_actions
        )
        SELECT
            g.organization_id,
            g.user_id,
            'alert_digest',
            'unread',
            NULL,
            NULL,
            NULL,
            'Notification digest',
            g.item_count::TEXT || ' alert notification(s) are ready.',
            jsonb_build_array(jsonb_build_object(
                'type', 'open_notifications',
                'digestIds', g.digest_ids
            ))
        FROM due_groups g
        WHERE EXISTS (
            SELECT 1
            FROM marked m
            WHERE m.organization_id = g.organization_id
              AND m.user_id = g.user_id
        )
        RETURNING id, organization_id, user_id, kind, state, alert_id
    )
    SELECT id, organization_id, user_id, kind, state, alert_id
    FROM inserted;
$$;

--------------DOWN
-- No-op: reverting would re-introduce the duplicate-digest race.
