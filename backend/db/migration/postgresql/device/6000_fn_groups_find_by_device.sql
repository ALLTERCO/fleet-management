--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_find_by_device(
    p_shelly_id VARCHAR(100)
)
RETURNS TABLE (
    group_id INTEGER
)
AS $$
BEGIN
    RETURN QUERY
    SELECT g.id
    FROM device.groups g
    WHERE p_shelly_id = ANY(g.devices);
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_find_by_device;
