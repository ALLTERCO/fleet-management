--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_set_test_result(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_status          VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE notifications.integration_endpoints
    SET
        last_test_at = NOW(),
        last_test_status = p_status,
        updated_at = NOW()
    WHERE id = p_id
      AND organization_id = p_organization_id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count > 0;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_set_test_result;
