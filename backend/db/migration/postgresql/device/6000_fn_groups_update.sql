--------------UP
CREATE OR REPLACE FUNCTION device.fn_groups_update(
    p_id INTEGER,
    p_name VARCHAR(300) DEFAULT NULL,
    p_devices TEXT[] DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL,
    p_parent_id INTEGER DEFAULT NULL,
    p_clear_parent BOOLEAN DEFAULT FALSE
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
    -- Validate parent exists if specified
    IF p_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM device.groups WHERE device.groups.id = p_parent_id) THEN
            RAISE EXCEPTION 'Parent group with id % does not exist', p_parent_id;
        END IF;
        -- Prevent circular reference
        IF p_parent_id = p_id THEN
            RAISE EXCEPTION 'Group cannot be its own parent';
        END IF;
    END IF;

    UPDATE device.groups g
    SET
        name = COALESCE(p_name, g.name),
        devices = COALESCE(p_devices, g.devices),
        metadata = COALESCE(p_metadata, g.metadata),
        parent_id = CASE
            WHEN p_clear_parent THEN NULL
            WHEN p_parent_id IS NOT NULL THEN p_parent_id
            ELSE g.parent_id
        END,
        updated = CURRENT_TIMESTAMP
    WHERE g.id = p_id;

    RETURN QUERY
    SELECT g.id, g.name, g.devices, g.metadata, g.parent_id, g.created, g.updated
    FROM device.groups g
    WHERE g.id = p_id;
END;
$$ LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_groups_update;
