--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_secret_set(
    p_endpoint_id        INTEGER,
    p_encrypted_payload  TEXT DEFAULT NULL
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

    INSERT INTO notifications.integration_endpoint_secrets AS s (
        endpoint_id, encrypted_payload, updated_at
    )
    VALUES (
        p_endpoint_id, p_encrypted_payload, NOW()
    )
    ON CONFLICT (endpoint_id)
    DO UPDATE SET
        encrypted_payload = EXCLUDED.encrypted_payload,
        updated_at = NOW();

    RETURN TRUE;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_secret_set;
