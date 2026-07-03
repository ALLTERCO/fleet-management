--------------UP
CREATE OR REPLACE FUNCTION device.fn_virtual_meta_fetch(
    p_organization_id VARCHAR,
    p_host_shelly_id VARCHAR
)
RETURNS SETOF device.virtual_metadata
LANGUAGE sql STABLE
AS $$
    SELECT *
      FROM device.virtual_metadata
     WHERE organization_id = p_organization_id
       AND host_shelly_id  = p_host_shelly_id;
$$;

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_list_promoted(
    p_organization_id VARCHAR
)
RETURNS SETOF device.virtual_metadata
LANGUAGE sql STABLE
AS $$
    SELECT *
      FROM device.virtual_metadata
     WHERE organization_id = p_organization_id
       AND promoted_at IS NOT NULL
     ORDER BY promoted_at DESC;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_virtual_meta_fetch(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS device.fn_virtual_meta_list_promoted(VARCHAR);
