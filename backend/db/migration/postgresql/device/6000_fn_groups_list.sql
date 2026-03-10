--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_list(
    p_parent_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER,
    name VARCHAR(300),
    devices TEXT[],
    metadata JSONB,
    parent_id INTEGER,
    created TIMESTAMPTZ,
    updated TIMESTAMPTZ
)
AS $$
BEGIN
    IF p_parent_id IS NULL THEN
        RETURN QUERY
        SELECT g.id, g.name, g.devices, g.metadata, g.parent_id, g.created, g.updated
        FROM device.groups g
        ORDER BY g.id;
    ELSE
        RETURN QUERY
        SELECT g.id, g.name, g.devices, g.metadata, g.parent_id, g.created, g.updated
        FROM device.groups g
        WHERE g.parent_id = p_parent_id
        ORDER BY g.id;
    END IF;
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_list;
