--------------UP
-- Make the device-status persist path lock-free.
--
-- device.fn_add runs on every device status report. Its
-- LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE is self-conflicting, so all
-- persists serialize through one lock. The lock is redundant for a single-row
-- upsert: the partial unique index device_list_external_id_unique makes
-- INSERT ... ON CONFLICT atomic, so different devices no longer block.
--
-- Safety is unchanged. Hardware replacement (device.fn_replace_hardware) keeps
-- its SHARE ROW EXCLUSIVE lock, which conflicts with this upsert's ROW EXCLUSIVE,
-- so a status write still blocks on an in-flight replacement. A retired
-- external_id is still refused by trigger trg_guard_retired_external_identity.
-- The SET touches only jdoc + updated.
SET search_path TO device, public;

CREATE OR REPLACE FUNCTION device.fn_add(p_external_id VARCHAR(50), p_jdoc JSONB)
RETURNS void
LANGUAGE sql
AS
$$
    INSERT INTO device.list (external_id, jdoc)
    SELECT p_external_id, p_jdoc
    WHERE p_external_id IS NOT NULL
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
    SET jdoc    = COALESCE(EXCLUDED.jdoc, device.list.jdoc),
        updated = now()::TIMESTAMPTZ;
$$;

--------------DOWN
-- Restore the table-locked check-then-write version (origin 6000_fn_add.sql).
SET search_path TO device, public;

CREATE OR REPLACE FUNCTION device.fn_add(p_external_id VARCHAR(50), p_jdoc JSONB)
RETURNS void
LANGUAGE plpgsql
AS
$$
BEGIN
    LOCK TABLE device.list IN SHARE ROW EXCLUSIVE MODE;
    IF p_external_id IS NOT NULL AND NOT EXISTS (SELECT * FROM device.list WHERE external_id = p_external_id) THEN
        INSERT INTO device.list (external_id, jdoc) VALUES (p_external_id, p_jdoc);
    ELSIF p_external_id IS NOT NULL THEN
        UPDATE
            device.list
        SET
            jdoc = CASE WHEN p_jdoc IS NOT NULL THEN p_jdoc ELSE jdoc END,
            updated = NOW()::TIMESTAMPTZ
        WHERE 1 = 1
            AND (p_external_id IS NULL OR external_id = p_external_id);
    END IF;
END;
$$;
