--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_remove_device(
    p_group_id INTEGER,
    p_shelly_id VARCHAR(100)
)
RETURNS BOOLEAN
AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    -- Check if device is in group
    SELECT p_shelly_id = ANY(devices) INTO v_exists FROM device.groups WHERE id = p_group_id;
    IF NOT v_exists THEN
        RETURN FALSE;
    END IF;

    -- Remove device from array
    UPDATE device.groups
    SET devices = array_remove(devices, p_shelly_id),
        updated = CURRENT_TIMESTAMP
    WHERE id = p_group_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_remove_device;
