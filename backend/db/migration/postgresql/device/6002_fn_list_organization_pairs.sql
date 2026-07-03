--------------UP
-- Startup load for the shellyID→orgId in-memory map.
CREATE OR REPLACE FUNCTION device.fn_list_organization_pairs()
RETURNS TABLE (external_id VARCHAR, organization_id VARCHAR)
LANGUAGE sql
AS $$
    SELECT external_id, organization_id
    FROM device.list
    WHERE external_id IS NOT NULL
      AND organization_id IS NOT NULL;
$$;
--------------DOWN
DROP FUNCTION device.fn_list_organization_pairs;
