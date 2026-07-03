--------------UP
-- Clear-via-worker: ha1_new_hex IS NULL in credential_pushes signals
-- "disable auth on this device". Worker calls Shelly.SetAuth all-null
-- and on success the row is deleted via fn_credential_finalize_cleared.
--
-- Drops the now-unused synchronous fn_credential_clear_rows — Clear
-- goes through the same job + push pipeline as Set / Rotate.

SET search_path TO organization;

CREATE OR REPLACE FUNCTION organization.fn_credential_finalize_cleared(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id
       AND device_id = p_device_id;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_clear_rows(VARCHAR, VARCHAR[]);

--------------DOWN
SET search_path TO organization;

CREATE FUNCTION organization.fn_credential_clear_rows(
    p_tenant_id  VARCHAR,
    p_device_ids VARCHAR[]
)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id
       AND device_id = ANY(p_device_ids);
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_finalize_cleared(VARCHAR, VARCHAR);
