--------------UP
DROP FUNCTION IF EXISTS logging.fn_audit_log_add(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR);
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
--------------DOWN
DROP FUNCTION IF EXISTS logging.fn_audit_log_add(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, BOOLEAN, TEXT, VARCHAR, TEXT[]);
CREATE OR REPLACE FUNCTION logging.fn_audit_log_add(
    p_event_type    VARCHAR,
    p_username      VARCHAR DEFAULT NULL,
    p_shelly_id     VARCHAR DEFAULT NULL,
    p_method        VARCHAR DEFAULT NULL,
    p_params        JSONB   DEFAULT NULL,
    p_success       BOOLEAN DEFAULT TRUE,
    p_error_message TEXT    DEFAULT NULL,
    p_ip_address    VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.audit_log (event_type, username, shelly_id, method, params, success, error_message, ip_address)
    VALUES (p_event_type, p_username, p_shelly_id, p_method, COALESCE(p_params, '{}'::jsonb), p_success, p_error_message, p_ip_address)
    RETURNING id;
$$;
