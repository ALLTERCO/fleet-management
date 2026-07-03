--------------UP
-- Delivery history list for Notification.History.List. Filters by
-- endpoint, job state, provider (via endpoint join), alert id, and a
-- [p_from, p_to) time window. `provider` is resolved through the
-- endpoint so UIs never need to join endpoint metadata themselves.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_list(
    p_organization_id VARCHAR,
    p_endpoint_id     INTEGER     DEFAULT NULL,
    p_state           VARCHAR     DEFAULT NULL,
    p_provider        VARCHAR     DEFAULT NULL,
    p_alert_id        INTEGER     DEFAULT NULL,
    p_from            TIMESTAMPTZ DEFAULT NULL,
    p_to              TIMESTAMPTZ DEFAULT NULL,
    p_limit           INTEGER     DEFAULT 200,
    p_offset          INTEGER     DEFAULT 0
)
RETURNS TABLE (
    total_count     BIGINT,
    id              INTEGER,
    organization_id VARCHAR,
    alert_id        INTEGER,
    inbox_item_id   INTEGER,
    endpoint_id     INTEGER,
    state           VARCHAR,
    created_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    attempt_count   INTEGER
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT j.*
        FROM notifications.delivery_jobs j
        LEFT JOIN notifications.integration_endpoints e
               ON e.id = j.endpoint_id
        WHERE j.organization_id = p_organization_id
          AND (p_endpoint_id IS NULL OR j.endpoint_id = p_endpoint_id)
          AND (p_state       IS NULL OR j.state       = p_state)
          AND (p_provider    IS NULL OR e.provider    = p_provider)
          AND (p_alert_id    IS NULL OR j.alert_id    = p_alert_id)
          AND (p_from        IS NULL OR j.created_at >= p_from)
          AND (p_to          IS NULL OR j.created_at <  p_to)
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        j.id, j.organization_id, j.alert_id, j.inbox_item_id, j.endpoint_id,
        j.state, j.created_at, j.completed_at, j.attempt_count
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY created_at DESC, id DESC
        LIMIT p_limit OFFSET p_offset
    ) j ON TRUE;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_delivery_job_list;
