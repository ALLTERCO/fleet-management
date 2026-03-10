--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_add_device(
    p_group_id INTEGER,
    p_shelly_id VARCHAR(100)
)
RETURNS BOOLEAN
AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    -- Check if group exists
    IF NOT EXISTS (SELECT 1 FROM device.groups WHERE id = p_group_id) THEN
        RETURN FALSE;
    END IF;

    -- Check if device already in group
    SELECT p_shelly_id = ANY(devices) INTO v_exists FROM device.groups WHERE id = p_group_id;
    IF v_exists THEN
        RETURN FALSE;
    END IF;

    -- Add device to array
    UPDATE device.groups
    SET devices = array_append(devices, p_shelly_id),
        updated = CURRENT_TIMESTAMP
    WHERE id = p_group_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_add_device;
