--------------UP
-- A physical Shelly's external_id is its model+MAC (globally unique); a virtual
-- device's is a random 128-bit hex (vdev_...). So external_id is globally unique
-- by construction, and fn_admit_batch already enforces one row per external_id
-- (no org filter, serialised by a table lock). Make that structural: a device
-- can never exist in two organizations, and a lookup by external_id cannot bleed
-- across tenants. Partial — a handful of legacy rows may carry a NULL id.
-- Pre-flight: fail with an actionable message (listing the count) rather than a
-- cryptic single-key duplicate error if pre-existing duplicates exist.
DO $$
DECLARE dup_count INT;
BEGIN
    SELECT count(*) INTO dup_count FROM (
        SELECT external_id FROM device.list
         WHERE external_id IS NOT NULL
         GROUP BY external_id HAVING count(*) > 1
    ) d;
    IF dup_count > 0 THEN
        RAISE EXCEPTION
            'device.list has % duplicated external_id value(s); resolve them before adding the unique index',
            dup_count;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS device_list_external_id_unique
    ON device.list (external_id)
    WHERE external_id IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS device.device_list_external_id_unique;
