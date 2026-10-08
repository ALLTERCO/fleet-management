--------------UP
-- One page of an organization's device -> groups map, so a process can load
-- the whole map once instead of reading each device as it connects. Devices
-- in no group are left out. Matches fn_group_find_by_member for a device
-- subject: whole-device rows of a device row in the same organization.
-- Pages are keyed by device row id; pass the last id of a page to get the next.
CREATE OR REPLACE FUNCTION organization.fn_group_device_map_page(
    p_organization_id  VARCHAR,
    p_after_device_id  INTEGER,
    p_limit            INTEGER
)
RETURNS TABLE (
    device_id   INTEGER,
    external_id VARCHAR,
    groups      JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_organization_id IS NULL OR p_limit IS NULL
       OR p_limit < 1 OR p_limit > 1000 THEN
        RAISE EXCEPTION 'Invalid device group map page'
            USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT gm.device_id,
           dl.external_id,
           jsonb_agg(
               jsonb_build_object('id', g.id, 'name', g.name)
               ORDER BY g.name, g.id
           )
      FROM organization.group_members gm
      JOIN device.list dl
        ON dl.organization_id = gm.organization_id
       AND dl.id = gm.device_id
      JOIN organization.groups g ON g.id = gm.group_id
     WHERE gm.organization_id = p_organization_id
       AND gm.subject_type = 'device'
       AND gm.subject_id IS NULL
       AND gm.entity_suffix IS NULL
       AND gm.device_id > COALESCE(p_after_device_id, 0)
       AND dl.external_id IS NOT NULL
     GROUP BY gm.device_id, dl.external_id
     ORDER BY gm.device_id
     LIMIT p_limit;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_group_device_map_page(VARCHAR, INTEGER, INTEGER);
