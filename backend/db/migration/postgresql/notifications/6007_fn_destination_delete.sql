--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_delete(
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
        FROM notifications.alert_rule_destination_groups
        WHERE destination_group_id = p_id
    ) THEN
        RAISE EXCEPTION 'destination group % is still referenced by alert rules', p_id
            USING ERRCODE = '23503';
    END IF;

    RETURN QUERY
    DELETE FROM notifications.destination_groups
    WHERE notifications.destination_groups.id = p_id
      AND notifications.destination_groups.organization_id = p_organization_id
    RETURNING notifications.destination_groups.id;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_delete;
