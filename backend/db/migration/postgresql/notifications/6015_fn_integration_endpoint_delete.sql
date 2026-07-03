--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM notifications.destination_group_members m
        JOIN notifications.destination_groups d
          ON d.id = m.destination_group_id
        WHERE d.organization_id = p_organization_id
          AND m.member_type = 'integration_endpoint'
          AND m.member_id = p_id::VARCHAR
    ) THEN
        RAISE EXCEPTION 'integration endpoint % is still referenced by destination groups', p_id
            USING ERRCODE = '23503';
    END IF;

    RETURN QUERY
    DELETE FROM notifications.integration_endpoints
    WHERE notifications.integration_endpoints.id = p_id
      AND notifications.integration_endpoints.organization_id = p_organization_id
    RETURNING notifications.integration_endpoints.id;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_delete;
