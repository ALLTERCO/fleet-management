--------------UP
-- audit_log gets a tenant column. Every write captures it; queries filter on it.
ALTER TABLE logging.audit_log
    ADD COLUMN IF NOT EXISTS organization_id VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_audit_log_org
    ON logging.audit_log (organization_id, ts DESC);

-- Backfill existing rows from device.list via shelly_id when possible.
UPDATE logging.audit_log a
   SET organization_id = d.organization_id
  FROM device.list d
 WHERE a.organization_id IS NULL
   AND a.shelly_id IS NOT NULL
   AND d.external_id = a.shelly_id
   AND d.organization_id IS NOT NULL;

-- Writer accepts organization_id per row; older callers pass NULL.
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        event_type, username, shelly_id, shelly_ids, method,
        params, success, error_message, ip_address, organization_id
    )
    SELECT
        e->>'event_type',
        e->>'username',
        e->>'shelly_id',
        CASE
            WHEN e ? 'shelly_ids'
                 AND jsonb_typeof(e->'shelly_ids') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(e->'shelly_ids'))
            WHEN e->>'shelly_id' IS NULL THEN NULL
            ELSE ARRAY[e->>'shelly_id']
        END,
        e->>'method',
        COALESCE(NULLIF(e->'params', 'null'::jsonb), '{}'::jsonb),
        COALESCE((e->>'success')::boolean, TRUE),
        e->>'error_message',
        e->>'ip_address',
        e->>'organization_id'
    FROM jsonb_array_elements(p_entries) e
    RETURNING id;
$$;

-- Reader gains a leading org filter. NULL = unrestricted (super-admin only).
DROP FUNCTION IF EXISTS logging.fn_audit_log_query(
    TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], VARCHAR, VARCHAR, INT, INT
);

CREATE OR REPLACE FUNCTION logging.fn_audit_log_query(
    p_organization_id VARCHAR(120) DEFAULT NULL,
    p_from            TIMESTAMPTZ  DEFAULT NULL,
    p_to              TIMESTAMPTZ  DEFAULT NULL,
    p_event_types     TEXT[]       DEFAULT NULL,
    p_username        VARCHAR      DEFAULT NULL,
    p_shelly_id       VARCHAR      DEFAULT NULL,
    p_limit           INT          DEFAULT 10000,
    p_offset          INT          DEFAULT 0
)
RETURNS TABLE (
    id              INT,
    ts              TIMESTAMPTZ,
    event_type      VARCHAR,
    username        VARCHAR,
    shelly_id       VARCHAR,
    shelly_ids      TEXT[],
    method          VARCHAR,
    params          JSONB,
    success         BOOLEAN,
    error_message   TEXT,
    ip_address      VARCHAR,
    organization_id VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id, a.ts, a.event_type, a.username, a.shelly_id, a.shelly_ids,
        a.method, a.params, a.success, a.error_message, a.ip_address,
        a.organization_id
    FROM logging.audit_log a
    WHERE
        (p_organization_id IS NULL OR a.organization_id = p_organization_id)
        AND (p_from IS NULL OR a.ts >= p_from)
        AND (p_to IS NULL OR a.ts <= p_to)
        AND (p_event_types IS NULL OR a.event_type = ANY(p_event_types))
        AND (p_username IS NULL OR a.username = p_username)
        AND (p_shelly_id IS NULL
             OR p_shelly_id = ANY(a.shelly_ids)
             OR a.shelly_id = p_shelly_id)
    ORDER BY a.ts DESC, a.id DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS logging.fn_audit_log_query(
    VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], VARCHAR, VARCHAR, INT, INT
);

CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        event_type, username, shelly_id, shelly_ids, method,
        params, success, error_message, ip_address
    )
    SELECT
        e->>'event_type',
        e->>'username',
        e->>'shelly_id',
        CASE
            WHEN e ? 'shelly_ids'
                 AND jsonb_typeof(e->'shelly_ids') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(e->'shelly_ids'))
            WHEN e->>'shelly_id' IS NULL THEN NULL
            ELSE ARRAY[e->>'shelly_id']
        END,
        e->>'method',
        COALESCE(NULLIF(e->'params', 'null'::jsonb), '{}'::jsonb),
        COALESCE((e->>'success')::boolean, TRUE),
        e->>'error_message',
        e->>'ip_address'
    FROM jsonb_array_elements(p_entries) e
    RETURNING id;
$$;

CREATE OR REPLACE FUNCTION logging.fn_audit_log_query(
    p_from        TIMESTAMPTZ DEFAULT NULL,
    p_to          TIMESTAMPTZ DEFAULT NULL,
    p_event_types TEXT[]      DEFAULT NULL,
    p_username    VARCHAR     DEFAULT NULL,
    p_shelly_id   VARCHAR     DEFAULT NULL,
    p_limit       INT         DEFAULT 10000,
    p_offset      INT         DEFAULT 0
)
RETURNS TABLE (
    id              INT,
    ts              TIMESTAMPTZ,
    event_type      VARCHAR,
    username        VARCHAR,
    shelly_id       VARCHAR,
    shelly_ids      TEXT[],
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
    SELECT a.id, a.ts, a.event_type, a.username, a.shelly_id, a.shelly_ids,
           a.method, a.params, a.success, a.error_message, a.ip_address
    FROM logging.audit_log a
    WHERE (p_from IS NULL OR a.ts >= p_from)
      AND (p_to IS NULL OR a.ts <= p_to)
      AND (p_event_types IS NULL OR a.event_type = ANY(p_event_types))
      AND (p_username IS NULL OR a.username = p_username)
      AND (p_shelly_id IS NULL
           OR p_shelly_id = ANY(a.shelly_ids)
           OR a.shelly_id = p_shelly_id)
    ORDER BY a.ts DESC, a.id DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

DROP INDEX IF EXISTS logging.idx_audit_log_org;
ALTER TABLE logging.audit_log DROP COLUMN IF EXISTS organization_id;
