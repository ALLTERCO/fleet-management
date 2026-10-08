--------------UP
-- The reconcile timer only needs to know which physical rows exist and when
-- each last changed. Reading the JSONB snapshot for every row each tick pays
-- the TOAST cost for data the tick almost never uses, so this returns the
-- narrow version list and the covering index answers it without the heap.
CREATE OR REPLACE FUNCTION device.fn_list_row_versions()
RETURNS TABLE (
    external_id VARCHAR(50),
    id INT,
    updated TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT d.external_id, d.id, d.updated
      FROM device.list d
     WHERE d.kind = 'physical';
$$;

CREATE INDEX IF NOT EXISTS idx_device_list_physical_row_version
    ON device.list (external_id, id, updated)
    WHERE kind = 'physical';

--------------DOWN
DROP INDEX IF EXISTS device.idx_device_list_physical_row_version;
DROP FUNCTION IF EXISTS device.fn_list_row_versions();
