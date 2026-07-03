--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_list(
    p_organization_id VARCHAR,
    p_provider        VARCHAR DEFAULT NULL,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count          BIGINT,
    id                   INTEGER,
    organization_id      VARCHAR,
    provider             VARCHAR,
    name                 VARCHAR,
    enabled              BOOLEAN,
    config               JSONB,
    has_secret_fields    BOOLEAN,
    last_test_at         TIMESTAMPTZ,
    last_test_status     VARCHAR,
    last_delivery_at     TIMESTAMPTZ,
    last_delivery_status VARCHAR,
    created_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT e.*
        FROM notifications.integration_endpoints e
        WHERE e.organization_id = p_organization_id
          AND (p_provider IS NULL OR e.provider = p_provider)
          AND (p_enabled IS NULL OR e.enabled = p_enabled)
          AND (p_query IS NULL OR e.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        e.id, e.organization_id, e.provider, e.name, e.enabled, e.config,
        (s.endpoint_id IS NOT NULL) AS has_secret_fields,
        e.last_test_at, e.last_test_status,
        e.last_delivery_at, e.last_delivery_status,
        e.created_at, e.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY name ASC
        LIMIT p_limit OFFSET p_offset
    ) e ON TRUE
    LEFT JOIN notifications.integration_endpoint_secrets s
      ON s.endpoint_id = e.id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_list;
