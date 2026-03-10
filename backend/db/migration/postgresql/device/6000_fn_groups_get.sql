--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_get(
    p_id INTEGER
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
    RETURN QUERY
    SELECT g.id, g.name, g.devices, g.metadata, g.parent_id, g.created, g.updated
    FROM device.groups g
    WHERE g.id = p_id;
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_get;
