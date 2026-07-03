--------------UP
-- Bulk insert; one round-trip per flush window.
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
        -- NULLIF promotes JSONB null to SQL NULL so COALESCE swaps in '{}'.
        COALESCE(NULLIF(e->'params', 'null'::jsonb), '{}'::jsonb),
        COALESCE((e->>'success')::boolean, TRUE),
        e->>'error_message',
        e->>'ip_address'
    FROM jsonb_array_elements(p_entries) e
    RETURNING id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS logging.fn_audit_log_add_batch(JSONB);
