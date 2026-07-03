--------------UP
-- Source of truth for "which devices belong to this org" used by the
-- per-org access cache to bound `scope: 'ALL'` and admin checks to the
-- caller's org.
CREATE OR REPLACE FUNCTION device.fn_list_shelly_ids_by_org(
    p_organization_id VARCHAR
)
RETURNS TABLE (external_id VARCHAR)
LANGUAGE sql
AS $$
    SELECT d.external_id::VARCHAR
    FROM device.list d
    WHERE d.organization_id = p_organization_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_list_shelly_ids_by_org(VARCHAR);
