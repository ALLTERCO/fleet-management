--------------UP
ALTER TABLE device.retired_external_identity
    DROP CONSTRAINT IF EXISTS retired_external_identity_organization_id_fkey,
    DROP CONSTRAINT IF EXISTS retired_external_identity_device_id_fkey;

COMMENT ON COLUMN device.retired_external_identity.organization_id IS
    'Organization snapshot at retirement; intentionally retained after tenant deletion.';
COMMENT ON COLUMN device.retired_external_identity.device_id IS
    'Logical device snapshot at retirement; intentionally retained after device deletion.';

CREATE OR REPLACE FUNCTION device.fn_guard_retired_external_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.external_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.external_id IS NOT DISTINCT FROM OLD.external_id THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
           SELECT 1
             FROM device.retired_external_identity retired
            WHERE retired.external_id = NEW.external_id
       )
    THEN
        RAISE EXCEPTION 'external device identity % is retired', NEW.external_id
            USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_retired_external_identity ON device.list;
CREATE TRIGGER trg_guard_retired_external_identity
BEFORE INSERT OR UPDATE OF external_id ON device.list
FOR EACH ROW EXECUTE FUNCTION device.fn_guard_retired_external_identity();

CREATE OR REPLACE FUNCTION device.fn_reset_hardware_sync_cursor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.external_id IS DISTINCT FROM OLD.external_id THEN
        DELETE FROM device_em.sync WHERE device = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_hardware_sync_cursor ON device.list;
CREATE TRIGGER trg_reset_hardware_sync_cursor
AFTER UPDATE OF external_id ON device.list
FOR EACH ROW EXECUTE FUNCTION device.fn_reset_hardware_sync_cursor();

CREATE OR REPLACE FUNCTION device.fn_lock_logical_device_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_first INTEGER;
    v_second INTEGER;
BEGIN
    v_first := CASE WHEN TG_OP = 'DELETE' THEN OLD.device ELSE NEW.device END;
    IF TG_OP = 'UPDATE' AND OLD.device IS DISTINCT FROM NEW.device THEN
        v_first := LEAST(OLD.device, NEW.device);
        v_second := GREATEST(OLD.device, NEW.device);
    END IF;
    IF v_first IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(73002, v_first);
    END IF;
    IF v_second IS NOT NULL AND v_second IS DISTINCT FROM v_first THEN
        PERFORM pg_advisory_xact_lock(73002, v_second);
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_logical_device_identity
    ON fm.logical_meter_point;
CREATE TRIGGER trg_lock_logical_device_identity
BEFORE INSERT OR UPDATE OR DELETE ON fm.logical_meter_point
FOR EACH ROW EXECUTE FUNCTION device.fn_lock_logical_device_identity();

--------------DOWN
-- Forward-only hardware identity safety migration.
