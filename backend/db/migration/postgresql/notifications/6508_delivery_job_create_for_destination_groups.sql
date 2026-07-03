--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_for_destination_groups(
    p_organization_id        VARCHAR,
    p_destination_group_ids  INTEGER[],
    p_alert_id               INTEGER,
    p_inbox_item_id          INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id          INTEGER,
    endpoint_id INTEGER,
    provider    VARCHAR
)
LANGUAGE sql
AS $$
    WITH endpoints AS (
        SELECT DISTINCT e.id AS endpoint_id, e.provider
        FROM notifications.destination_groups dg
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'integration_endpoint'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.integration_endpoints e
          ON e.id = m.member_id::INTEGER
         AND e.organization_id = p_organization_id
         AND e.enabled = TRUE
        WHERE dg.organization_id = p_organization_id
          AND dg.enabled = TRUE
          AND dg.id = ANY(p_destination_group_ids)
    ),
    inserted AS (
        INSERT INTO notifications.delivery_jobs (
            organization_id, alert_id, inbox_item_id, endpoint_id, state
        )
        SELECT
            p_organization_id,
            p_alert_id,
            p_inbox_item_id,
            e.endpoint_id,
            'queued'
        FROM endpoints e
        RETURNING id, endpoint_id
    )
    SELECT
        i.id,
        i.endpoint_id,
        e.provider
    FROM inserted i
    JOIN notifications.integration_endpoints e ON e.id = i.endpoint_id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_for_destination_groups(
    VARCHAR, INTEGER[], INTEGER, INTEGER
);
