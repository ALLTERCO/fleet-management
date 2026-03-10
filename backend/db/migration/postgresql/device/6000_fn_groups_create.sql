--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_create(
    p_name VARCHAR(300),
    p_devices TEXT[] DEFAULT '{}',
    p_metadata JSONB DEFAULT '{}',
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
DECLARE
    v_id INTEGER;
BEGIN
    -- Validate parent exists if specified
    IF p_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM device.groups WHERE device.groups.id = p_parent_id) THEN
            RAISE EXCEPTION 'Parent group with id % does not exist', p_parent_id;
        END IF;
    END IF;

    INSERT INTO device.groups (name, devices, metadata, parent_id)
    VALUES (p_name, p_devices, p_metadata, p_parent_id)
    RETURNING device.groups.id INTO v_id;

    RETURN QUERY
    SELECT g.id, g.name, g.devices, g.metadata, g.parent_id, g.created, g.updated
    FROM device.groups g
    WHERE g.id = v_id;
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_create;
