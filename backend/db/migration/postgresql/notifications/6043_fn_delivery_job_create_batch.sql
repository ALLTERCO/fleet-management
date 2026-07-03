--------------UP
-- Fan-out from an alert to one delivery_jobs row per enabled integration
-- endpoint referenced by the alert's rule. Returns every row it created
-- so the engine can enqueue graphile-worker tasks + emit WS events.
--
-- Endpoint set = {e : e ∈ destination_group_members(rule's groups) ∧
--                     e.member_type = 'integration_endpoint' ∧
--                     endpoint.enabled = TRUE ∧
--                     endpoint.organization_id = rule.org}.
-- `alert_id` is ON DELETE SET NULL so cascading a resolved alert does
-- not trash the delivery audit trail.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_batch(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_alert_id        INTEGER,
    p_inbox_item_id   INTEGER DEFAULT NULL
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
        FROM notifications.alert_rule_destination_groups rdg
        JOIN notifications.destination_groups dg
          ON dg.id = rdg.destination_group_id
         AND dg.organization_id = p_organization_id
         AND dg.enabled = TRUE
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'integration_endpoint'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.integration_endpoints e
          ON e.id = m.member_id::INTEGER
         AND e.organization_id = p_organization_id
         AND e.enabled = TRUE
        WHERE rdg.rule_id = p_rule_id
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
DROP FUNCTION notifications.fn_delivery_job_create_batch;
