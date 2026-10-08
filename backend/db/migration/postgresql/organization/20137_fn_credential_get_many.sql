--------------UP
SET search_path TO public;

-- Reads the active credentials of the devices a burst of Credential.Changed
-- events named, in one call, inside one tenant.
CREATE OR REPLACE FUNCTION organization.fn_credential_get_many(
    p_tenant_id  VARCHAR,
    p_device_ids VARCHAR[]
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND d.external_id = ANY(p_device_ids)
       AND c.retired_at IS NULL
     ORDER BY d.external_id, c.id;
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS organization.fn_credential_get_many(VARCHAR, VARCHAR[]);
