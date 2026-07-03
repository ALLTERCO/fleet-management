--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_secret_get(
    p_endpoint_id INTEGER
)
RETURNS TABLE (
    endpoint_id        INTEGER,
    encrypted_payload  TEXT,
    updated_at         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        s.endpoint_id,
        s.encrypted_payload,
        s.updated_at
    FROM notifications.integration_endpoint_secrets s
    WHERE s.endpoint_id = p_endpoint_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_secret_get;
