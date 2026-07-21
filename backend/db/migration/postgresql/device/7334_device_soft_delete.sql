--------------UP
-- Soft delete (retire) for physical devices. The everyday "Delete" retires a
-- device: the row stays, so its stable id and all telemetry keyed to that id
-- survive, and it disappears from fleet lists until restored. Hard purge stays
-- a separate op (device.fn_full_delete). Mirrors Azure IoT Hub disable-vs-delete.
--
-- Telemetry does NOT un-retire: a retired device that keeps reporting stays
-- hidden (its history still accrues under its id) until an explicit Restore, so
-- retire is predictable. fn_add is left untouched on purpose.
ALTER TABLE device.list ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Retire: hide the device but keep its id, history, and every reference intact.
-- No-op if already retired.
CREATE OR REPLACE FUNCTION device.fn_retire(p_id INT)
RETURNS void
AS
$$
BEGIN
    UPDATE device.list SET deleted_at = NOW()
     WHERE id = p_id AND deleted_at IS NULL;
END;
$$
LANGUAGE plpgsql;

-- Restore: bring a retired device back with its full history. No-op if not
-- retired.
CREATE OR REPLACE FUNCTION device.fn_restore(p_id INT)
RETURNS void
AS
$$
BEGIN
    UPDATE device.list SET deleted_at = NULL
     WHERE id = p_id AND deleted_at IS NOT NULL;
END;
$$
LANGUAGE plpgsql;

-- The retired ("trash") list for an org: what can be restored or purged.
CREATE OR REPLACE FUNCTION device.fn_list_retired(p_organization_id VARCHAR)
RETURNS TABLE (
    id INT,
    external_id VARCHAR,
    organization_id VARCHAR,
    kind VARCHAR,
    deleted_at TIMESTAMPTZ
)
AS
$$
    SELECT id, external_id, organization_id, kind, deleted_at
      FROM device.list
     WHERE organization_id = p_organization_id
       AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC;
$$
LANGUAGE sql STABLE;

-- Every retired device across orgs — seeds the in-memory retired set at boot so
-- the device collector hides them even before the first retire/restore call.
CREATE OR REPLACE FUNCTION device.fn_list_retired_all()
RETURNS TABLE (external_id VARCHAR)
AS
$$
    SELECT external_id FROM device.list WHERE deleted_at IS NOT NULL;
$$
LANGUAGE sql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_list_retired_all();
DROP FUNCTION IF EXISTS device.fn_list_retired(VARCHAR);
DROP FUNCTION IF EXISTS device.fn_restore(INT);
DROP FUNCTION IF EXISTS device.fn_retire(INT);
ALTER TABLE device.list DROP COLUMN IF EXISTS deleted_at;
