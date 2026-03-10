--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_delete(
    p_id INTEGER
)
RETURNS BOOLEAN
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM device.groups WHERE id = p_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_delete;
