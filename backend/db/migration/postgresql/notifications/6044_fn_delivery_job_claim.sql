--------------UP
-- Claim a queued job for the outbox worker. FOR UPDATE SKIP LOCKED so
-- multiple worker processes compete safely and never double-process the
-- same job. Transitions state queued → processing and returns the row
-- enriched with endpoint config + provider so the adapter has
-- everything it needs in one round trip.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_claim(
    p_id INTEGER
)
RETURNS TABLE (
    id               INTEGER,
    organization_id  VARCHAR,
    alert_id         INTEGER,
    inbox_item_id    INTEGER,
    endpoint_id      INTEGER,
    provider         VARCHAR,
    endpoint_name    VARCHAR,
    endpoint_enabled BOOLEAN,
    endpoint_config  JSONB,
    attempt_count    INTEGER
)
LANGUAGE sql
AS $$
    WITH claimed AS (
        UPDATE notifications.delivery_jobs j
        SET state = 'processing'
        WHERE j.id = (
            SELECT id
            FROM notifications.delivery_jobs
            WHERE id = p_id AND state = 'queued'
            FOR UPDATE SKIP LOCKED
        )
        RETURNING j.*
    )
    SELECT
        c.id, c.organization_id, c.alert_id, c.inbox_item_id, c.endpoint_id,
        e.provider, e.name AS endpoint_name, e.enabled AS endpoint_enabled,
        e.config AS endpoint_config,
        c.attempt_count
    FROM claimed c
    JOIN notifications.integration_endpoints e ON e.id = c.endpoint_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_delivery_job_claim;
