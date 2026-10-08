--------------UP
SET search_path TO public;

-- A snapshot save changes only jdoc and updated. With updated in an index no
-- save can be a heap-only (HOT) update, so each one wrote a new entry into
-- every index of device.list. The reconcile still reads updated, from the
-- heap row, without the jdoc (TOAST) column.
DROP INDEX IF EXISTS device.idx_device_list_physical_row_version;
CREATE INDEX IF NOT EXISTS idx_device_list_physical_rows
    ON device.list (external_id, id)
    WHERE kind = 'physical';

-- Free space on each page so the next version of a row fits on the same page.
ALTER TABLE device.list SET (fillfactor = 70);

--------------DOWN
SET search_path TO public;

ALTER TABLE device.list RESET (fillfactor);
DROP INDEX IF EXISTS device.idx_device_list_physical_rows;
CREATE INDEX IF NOT EXISTS idx_device_list_physical_row_version
    ON device.list (external_id, id, updated)
    WHERE kind = 'physical';
