--------------UP
CREATE FUNCTION device.fn_groups_add_devices_batch(
    p_group_id INTEGER,
    p_shelly_ids VARCHAR(100)[]
)
RETURNS INTEGER
AS $$
DECLARE
    v_current_devices TEXT[];
    v_new_devices TEXT[];
BEGIN
    -- Check if group exists
    IF NOT EXISTS (SELECT 1 FROM device.groups WHERE id = p_group_id) THEN
        RETURN 0;
    END IF;

    -- Get current devices
    SELECT devices INTO v_current_devices
    FROM device.groups WHERE id = p_group_id;

    -- Filter out devices already in the group
    SELECT array_agg(sid) INTO v_new_devices
    FROM unnest(p_shelly_ids) AS sid
    WHERE sid != ALL(COALESCE(v_current_devices, '{}'));

    IF v_new_devices IS NULL OR array_length(v_new_devices, 1) IS NULL THEN
        RETURN 0;
    END IF;

    -- Add all new devices in one atomic update
    UPDATE device.groups
    SET devices = array_cat(devices, v_new_devices),
        updated = CURRENT_TIMESTAMP
    WHERE id = p_group_id;

    RETURN array_length(v_new_devices, 1);
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION device.fn_groups_add_devices_batch;
