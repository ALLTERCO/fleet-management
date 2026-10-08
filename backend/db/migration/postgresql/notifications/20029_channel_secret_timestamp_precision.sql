--------------UP
-- The secret compare-and-swap round-trips updated_at through the caller, which
-- carries it as a JS Date — millisecond precision. The column was plain
-- TIMESTAMPTZ, which Postgres stores at microsecond precision, so the value
-- coming back had lost its last three digits and the exact match found no row.
-- Every secret write was then reported as a concurrent rotation.
--
-- Store the precision the caller can carry, so one value round-trips unchanged
-- and the comparison needs no special handling.
ALTER TABLE notifications.channel_secrets
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ(3);

-- Restored verbatim from 20021 now that the precisions agree; kept here so the
-- function and the column it compares are changed together.
CREATE OR REPLACE FUNCTION notifications.fn_channel_secret_set(
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
    IF p_encrypted_payload IS NULL OR LENGTH(TRIM(p_encrypted_payload)) = 0 THEN
        DELETE FROM notifications.channel_secrets
        WHERE endpoint_id = p_endpoint_id
          AND (p_expected_updated_at IS NULL OR updated_at = p_expected_updated_at);
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0 OR p_expected_updated_at IS NULL;
    END IF;

    IF p_expected_updated_at IS NULL THEN
        INSERT INTO notifications.channel_secrets (endpoint_id, encrypted_payload, updated_at)
        VALUES (p_endpoint_id, p_encrypted_payload, NOW())
        ON CONFLICT (endpoint_id) DO NOTHING;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RETURN v_affected > 0;
    END IF;

    UPDATE notifications.channel_secrets
    SET encrypted_payload = p_encrypted_payload, updated_at = NOW()
    WHERE endpoint_id = p_endpoint_id
      AND updated_at = p_expected_updated_at;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN v_affected > 0;
END;
$$;
--------------DOWN
ALTER TABLE notifications.channel_secrets
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ;
