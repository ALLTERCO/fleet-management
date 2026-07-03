--------------UP
-- CAS variant: p_expected_updated_at NULL = insert path; otherwise update only if unchanged.
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_secret_set(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_secret_set(
    p_endpoint_id          INTEGER,
    p_encrypted_payload    TEXT,
    p_expected_updated_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_affected INTEGER;
BEGIN
    -- Delete-or-clear path: caller wants to remove the row.
    IF p_encrypted_payload IS NULL OR LENGTH(TRIM(p_encrypted_payload)) = 0 THEN
        DELETE FROM notifications.integration_endpoint_secrets
        WHERE endpoint_id = p_endpoint_id
          AND (p_expected_updated_at IS NULL
               OR updated_at = p_expected_updated_at);
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        -- No-row + caller expected no-row = success.
        RETURN v_affected > 0 OR p_expected_updated_at IS NULL;
    END IF;

    -- Insert-if-absent path: caller saw no row.
    IF p_expected_updated_at IS NULL THEN
        INSERT INTO notifications.integration_endpoint_secrets (
            endpoint_id, encrypted_payload, updated_at
        )
        VALUES (p_endpoint_id, p_encrypted_payload, NOW())
        ON CONFLICT (endpoint_id) DO NOTHING;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0;
    END IF;

    -- Update-if-unchanged path: caller saw row at expected_updated_at.
    UPDATE notifications.integration_endpoint_secrets
    SET encrypted_payload = p_encrypted_payload, updated_at = NOW()
    WHERE endpoint_id = p_endpoint_id
      AND updated_at = p_expected_updated_at;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN v_affected > 0;
END;
$$;
--------------DOWN
-- Revert handled by re-running 6017 migration.
