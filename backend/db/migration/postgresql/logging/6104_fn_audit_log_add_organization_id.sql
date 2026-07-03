--------------UP
-- Audit fns gain organization_id end-to-end. Migration 6103's CREATE OR REPLACE
-- of fn_audit_log_add_batch silently dropped the column added in 6102. The
-- single-row fn never had it. This restores the batch fn and adds the param
-- to the single-row fn so every write path (normal batch, per-row fallback,
-- DLQ drain) preserves tenant scope.

-- Batch fn — restore organization_id column write (6103 omitted it).
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, shelly_id, shelly_ids, method,
        params, success, error_message, ip_address, organization_id
    )
    SELECT
        COALESCE((e->>'ts')::timestamptz, NOW()),
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

-- Single-row fn — add p_organization_id param + column write.
DROP FUNCTION IF EXISTS logging.fn_audit_log_add(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR, TEXT[], TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add(
    p_event_type      VARCHAR,
    p_username        VARCHAR DEFAULT NULL,
    p_shelly_id       VARCHAR DEFAULT NULL,
    p_method          VARCHAR DEFAULT NULL,
    p_params          JSONB   DEFAULT NULL,
    p_success         BOOLEAN DEFAULT TRUE,
    p_error_message   TEXT    DEFAULT NULL,
    p_ip_address      VARCHAR DEFAULT NULL,
    p_shelly_ids      TEXT[]  DEFAULT NULL,
    p_ts              TIMESTAMPTZ DEFAULT NULL,
    p_organization_id VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, shelly_id, shelly_ids, method,
        params, success, error_message, ip_address, organization_id
    )
    VALUES (
        COALESCE(p_ts, NOW()),
        p_event_type,
        p_username,
        p_shelly_id,
        COALESCE(p_shelly_ids, CASE WHEN p_shelly_id IS NULL THEN NULL ELSE ARRAY[p_shelly_id] END),
        p_method,
        COALESCE(p_params, '{}'::jsonb),
        p_success,
        p_error_message,
        p_ip_address,
        p_organization_id
    )
    RETURNING id;
$$;

--------------DOWN
-- Restore 6103's signatures (batch fn without organization_id, single-row fn without p_organization_id).
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add_batch(p_entries JSONB)
RETURNS SETOF INTEGER
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (
        ts, event_type, username, shelly_id, shelly_ids, method,
        params, success, error_message, ip_address
    )
    SELECT
        COALESCE((e->>'ts')::timestamptz, NOW()),
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

DROP FUNCTION IF EXISTS logging.fn_audit_log_add(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR, TEXT[], TIMESTAMPTZ, VARCHAR);
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add(
    p_event_type    VARCHAR,
    p_username      VARCHAR DEFAULT NULL,
    p_shelly_id     VARCHAR DEFAULT NULL,
    p_method        VARCHAR DEFAULT NULL,
    p_params        JSONB   DEFAULT NULL,
    p_success       BOOLEAN DEFAULT TRUE,
    p_error_message TEXT    DEFAULT NULL,
    p_ip_address    VARCHAR DEFAULT NULL,
    p_shelly_ids    TEXT[]  DEFAULT NULL,
    p_ts            TIMESTAMPTZ DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (ts, event_type, username, shelly_id, shelly_ids, method, params, success, error_message, ip_address)
    VALUES (
        COALESCE(p_ts, NOW()),
        p_event_type,
        p_username,
        p_shelly_id,
        COALESCE(p_shelly_ids, CASE WHEN p_shelly_id IS NULL THEN NULL ELSE ARRAY[p_shelly_id] END),
        p_method,
        COALESCE(p_params, '{}'::jsonb),
        p_success,
        p_error_message,
        p_ip_address
    )
    RETURNING id;
$$;
