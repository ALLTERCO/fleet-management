--------------UP
CREATE OR REPLACE FUNCTION logging.fn_audit_log_query(
    p_from          TIMESTAMPTZ DEFAULT NULL,
    p_to            TIMESTAMPTZ DEFAULT NULL,
    p_event_types   TEXT[]      DEFAULT NULL,
    p_username      VARCHAR     DEFAULT NULL,
    p_shelly_id     VARCHAR     DEFAULT NULL,
    p_limit         INT         DEFAULT 10000,
    p_offset        INT         DEFAULT 0
)
RETURNS TABLE (
    id              INT,
    ts              TIMESTAMPTZ,
    event_type      VARCHAR,
    username        VARCHAR,
    shelly_id       VARCHAR,
    method          VARCHAR,
    params          JSONB,
    success         BOOLEAN,
    error_message   TEXT,
    ip_address      VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id,
        a.ts,
        a.event_type,
        a.username,
        a.shelly_id,
        a.method,
        a.params,
        a.success,
        a.error_message,
        a.ip_address
    FROM logging.audit_log a
    WHERE
        (p_from IS NULL OR a.ts >= p_from) AND
        (p_to IS NULL OR a.ts <= p_to) AND
        (p_event_types IS NULL OR a.event_type = ANY(p_event_types)) AND
        (p_username IS NULL OR a.username = p_username) AND
        (p_shelly_id IS NULL OR a.shelly_id = p_shelly_id)
    ORDER BY a.ts DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
--------------DOWN
DROP FUNCTION logging.fn_audit_log_query;
