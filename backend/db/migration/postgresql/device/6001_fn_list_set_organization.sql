--------------UP
-- Set / clear the org that owns a device. Used on WaitingRoom approval.
CREATE OR REPLACE FUNCTION device.fn_list_set_organization(
    p_external_id    VARCHAR,
    p_organization_id VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE device.list
    SET organization_id = p_organization_id,
        updated = NOW()
    WHERE external_id = p_external_id;
$$;
--------------DOWN
DROP FUNCTION device.fn_list_set_organization;
