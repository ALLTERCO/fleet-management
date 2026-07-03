--------------UP
-- Optional p_ts override preserves original event time when entries spill through the Redis DLQ and are drained later.
DROP FUNCTION IF EXISTS logging.fn_audit_log_add(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR, TEXT[]);
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

-- Batch fn — same override via per-entry 'ts' field. Falls back to NOW() when absent.
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
--------------DOWN
-- Restore the pre-override signatures.
DROP FUNCTION IF EXISTS logging.fn_audit_log_add(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR, TEXT[], TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add(
    p_event_type    VARCHAR,
    p_username      VARCHAR DEFAULT NULL,
    p_shelly_id     VARCHAR DEFAULT NULL,
    p_method        VARCHAR DEFAULT NULL,
    p_params        JSONB   DEFAULT NULL,
    p_success       BOOLEAN DEFAULT TRUE,
    p_error_message TEXT    DEFAULT NULL,
    p_ip_address    VARCHAR DEFAULT NULL,
    p_shelly_ids    TEXT[]  DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (event_type, username, shelly_id, shelly_ids, method, params, success, error_message, ip_address)
    VALUES (
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
