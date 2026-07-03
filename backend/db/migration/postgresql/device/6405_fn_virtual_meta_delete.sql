--------------UP
CREATE OR REPLACE FUNCTION device.fn_virtual_meta_delete(
    p_organization_id VARCHAR,
    p_host_shelly_id VARCHAR,
    p_component_key VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM device.virtual_metadata
     WHERE organization_id = p_organization_id
       AND host_shelly_id  = p_host_shelly_id
       AND component_key   = p_component_key;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_virtual_meta_delete(VARCHAR, VARCHAR, VARCHAR);
