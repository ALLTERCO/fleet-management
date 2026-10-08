--------------UP
-- A peer's access-change signal can be lost, so each process re-reads the
-- rows whose access left ALLOWED, or that were deleted, since its last check.
-- access_changed_at moves only when control_access does: a snapshot save
-- writes neither column, so it stays a heap-only update and never enters the
-- index below. Rows are grouped by owner; '' is the unowned group, since a
-- deny leaves an unowned row unowned.
ALTER TABLE device.list ADD COLUMN IF NOT EXISTS access_changed_at TIMESTAMPTZ;

-- Millisecond stamps: the reader's keyset position round-trips exactly.
CREATE OR REPLACE FUNCTION device.fn_stamp_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
BEGIN
    -- A new row is a decision only when it is born DENIED; a pending snapshot
    -- row is not one.
    IF TG_OP = 'INSERT' THEN
        IF NEW.control_access = 2 THEN
            NEW.access_changed_at := date_trunc('milliseconds', clock_timestamp());
        END IF;
    ELSIF NEW.control_access IS DISTINCT FROM OLD.control_access THEN
        NEW.access_changed_at := date_trunc('milliseconds', clock_timestamp());
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER device_list_stamp_access_change
BEFORE INSERT OR UPDATE OF control_access ON device.list
FOR EACH ROW EXECUTE FUNCTION device.fn_stamp_access_change();

CREATE INDEX IF NOT EXISTS idx_device_list_access_revoked
    ON device.list (COALESCE(organization_id, ''), access_changed_at, id)
    WHERE control_access <> 3 AND access_changed_at IS NOT NULL;

-- A deleted row leaves nothing to stamp, so its deletion is kept here for a
-- day, far longer than any recheck interval. Row ids are never reused, so they
-- share one keyset with device.list.
CREATE TABLE IF NOT EXISTS device.access_deleted (
    device_id        INTEGER PRIMARY KEY,
    external_id      VARCHAR(50) NOT NULL,
    organization_key VARCHAR(120) NOT NULL,
    deleted_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_access_deleted_org
    ON device.access_deleted (organization_key, deleted_at, device_id);
CREATE INDEX IF NOT EXISTS idx_device_access_deleted_at
    ON device.access_deleted (deleted_at);

CREATE OR REPLACE FUNCTION device.fn_record_access_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
BEGIN
    IF OLD.external_id IS NULL THEN
        RETURN OLD;
    END IF;
    DELETE FROM device.access_deleted
     WHERE deleted_at < clock_timestamp() - interval '1 day';
    INSERT INTO device.access_deleted (
        device_id, external_id, organization_key, deleted_at
    ) VALUES (
        OLD.id,
        OLD.external_id,
        COALESCE(OLD.organization_id, ''),
        date_trunc('milliseconds', clock_timestamp())
    )
    ON CONFLICT (device_id) DO NOTHING;
    RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER device_list_record_access_deleted
AFTER DELETE ON device.list
FOR EACH ROW EXECUTE FUNCTION device.fn_record_access_deleted();

-- One owner group's devices whose access left ALLOWED or whose row was
-- deleted, after the keyset position, oldest change first. A row that is
-- ALLOWED again, or a deleted id admitted again, is not returned. A deleted
-- device has no access (NULL).
CREATE OR REPLACE FUNCTION device.fn_list_access_revoked(
    p_organization_id VARCHAR,
    p_after_at TIMESTAMPTZ,
    p_after_id INTEGER,
    p_limit INTEGER
)
RETURNS TABLE (
    external_id VARCHAR,
    id INTEGER,
    control_access SMALLINT,
    access_changed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS
$$
    SELECT changed.external_id, changed.id, changed.control_access,
           changed.access_changed_at
      FROM (
          (SELECT d.external_id, d.id, d.control_access, d.access_changed_at
             FROM device.list d
            WHERE COALESCE(d.organization_id, '') = p_organization_id
              AND d.control_access <> 3
              AND d.access_changed_at IS NOT NULL
              AND (d.access_changed_at, d.id) > (p_after_at, p_after_id)
            ORDER BY d.access_changed_at, d.id
            LIMIT p_limit)
          UNION ALL
          (SELECT g.external_id, g.device_id, NULL::SMALLINT, g.deleted_at
             FROM device.access_deleted g
            WHERE g.organization_key = p_organization_id
              AND (g.deleted_at, g.device_id) > (p_after_at, p_after_id)
              AND NOT EXISTS (
                  SELECT 1
                    FROM device.list l
                   WHERE l.external_id = g.external_id
                     AND l.control_access = 3
              )
            ORDER BY g.deleted_at, g.device_id
            LIMIT p_limit)
      ) changed
     ORDER BY changed.access_changed_at, changed.id
     LIMIT p_limit;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device.fn_list_access_revoked(
    VARCHAR, TIMESTAMPTZ, INTEGER, INTEGER
);
DROP TRIGGER IF EXISTS device_list_record_access_deleted ON device.list;
DROP FUNCTION IF EXISTS device.fn_record_access_deleted();
DROP TABLE IF EXISTS device.access_deleted;
DROP INDEX IF EXISTS device.idx_device_list_access_revoked;
DROP TRIGGER IF EXISTS device_list_stamp_access_change ON device.list;
DROP FUNCTION IF EXISTS device.fn_stamp_access_change();
ALTER TABLE device.list DROP COLUMN IF EXISTS access_changed_at;
