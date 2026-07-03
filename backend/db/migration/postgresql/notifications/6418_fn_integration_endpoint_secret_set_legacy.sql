--------------UP
-- Restore the 2-arg signature dropped by 6417. This legacy path is explicitly
-- insert-or-replace; the 3-arg signature remains CAS-protected.
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_secret_set(
    p_endpoint_id        INTEGER,
    p_encrypted_payload  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_encrypted_payload IS NULL OR LENGTH(TRIM(p_encrypted_payload)) = 0 THEN
        DELETE FROM notifications.integration_endpoint_secrets
        WHERE endpoint_id = p_endpoint_id;
        RETURN TRUE;
    END IF;

    INSERT INTO notifications.integration_endpoint_secrets (
        endpoint_id, encrypted_payload, updated_at
    )
    VALUES (p_endpoint_id, p_encrypted_payload, NOW())
    ON CONFLICT (endpoint_id) DO UPDATE SET
        encrypted_payload = EXCLUDED.encrypted_payload,
        updated_at = NOW();
    RETURN TRUE;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_secret_set(INTEGER, TEXT);
