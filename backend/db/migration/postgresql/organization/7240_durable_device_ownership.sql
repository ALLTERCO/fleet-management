--------------UP
-- Durable records belong to the logical Fleet device. The existing device_id
-- columns remain the hardware identity used when the operation occurred.

CREATE OR REPLACE FUNCTION organization.fn_require_logical_device_id(
    p_tenant_id VARCHAR,
    p_external_id VARCHAR
)
RETURNS INT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_device_id INT;
BEGIN
    SELECT d.id INTO v_device_id
      FROM device.list d
     WHERE d.organization_id = p_tenant_id
       AND d.external_id = p_external_id;

    IF v_device_id IS NULL THEN
        RAISE EXCEPTION 'device % not found in organization %',
            p_external_id, p_tenant_id;
    END IF;
    RETURN v_device_id;
END;
$$;

ALTER TABLE organization.backup_units
    ADD COLUMN IF NOT EXISTS logical_device_id INT;
ALTER TABLE organization.firmware_units
    ADD COLUMN IF NOT EXISTS logical_device_id INT;
ALTER TABLE organization.certificate_pushes
    ADD COLUMN IF NOT EXISTS logical_device_id INT;
ALTER TABLE organization.credential_pushes
    ADD COLUMN IF NOT EXISTS logical_device_id INT;
ALTER TABLE organization.credential_reveal_audit
    ADD COLUMN IF NOT EXISTS logical_device_id INT;
ALTER TABLE organization.device_credentials
    ADD COLUMN IF NOT EXISTS logical_device_id INT,
    ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS retired_reason VARCHAR(32);

UPDATE organization.backup_units r
   SET logical_device_id = d.id
  FROM device.list d
 WHERE r.logical_device_id IS NULL
   AND d.organization_id = r.tenant_id
   AND d.external_id = r.device_id;

UPDATE organization.firmware_units r
   SET logical_device_id = d.id
  FROM device.list d
 WHERE r.logical_device_id IS NULL
   AND d.organization_id = r.tenant_id
   AND d.external_id = r.device_id;

UPDATE organization.certificate_pushes r
   SET logical_device_id = d.id
  FROM device.list d
 WHERE r.logical_device_id IS NULL
   AND d.organization_id = r.tenant_id
   AND d.external_id = r.device_id;

UPDATE organization.credential_pushes r
   SET logical_device_id = d.id
  FROM device.list d
 WHERE r.logical_device_id IS NULL
   AND d.organization_id = r.tenant_id
   AND d.external_id = r.device_id;

UPDATE organization.credential_reveal_audit r
   SET logical_device_id = d.id
  FROM device.list d
 WHERE r.logical_device_id IS NULL
   AND d.organization_id = r.tenant_id
   AND d.external_id = r.device_id;

UPDATE organization.device_credentials r
   SET logical_device_id = d.id
  FROM device.list d
 WHERE r.logical_device_id IS NULL
   AND d.organization_id = r.tenant_id
   AND d.external_id = r.device_id;

DO $$
DECLARE
    v_unresolved BIGINT;
BEGIN
    SELECT
        (SELECT count(*) FROM organization.backup_units
          WHERE logical_device_id IS NULL)
      + (SELECT count(*) FROM organization.firmware_units
          WHERE logical_device_id IS NULL)
      + (SELECT count(*) FROM organization.certificate_pushes
          WHERE logical_device_id IS NULL)
      + (SELECT count(*) FROM organization.credential_pushes
          WHERE logical_device_id IS NULL)
      + (SELECT count(*) FROM organization.credential_reveal_audit
          WHERE logical_device_id IS NULL)
      + (SELECT count(*) FROM organization.device_credentials
          WHERE logical_device_id IS NULL)
      INTO v_unresolved;
    RAISE NOTICE 'durable device owners unresolved after backfill: %',
        v_unresolved;
END;
$$;

ALTER TABLE organization.backup_units
    ADD CONSTRAINT backup_units_logical_device_fk
        FOREIGN KEY (logical_device_id)
        REFERENCES device.list(id) ON DELETE SET NULL;
ALTER TABLE organization.firmware_units
    ADD CONSTRAINT firmware_units_logical_device_fk
        FOREIGN KEY (logical_device_id)
        REFERENCES device.list(id) ON DELETE SET NULL;
ALTER TABLE organization.certificate_pushes
    ADD CONSTRAINT certificate_pushes_logical_device_fk
        FOREIGN KEY (logical_device_id)
        REFERENCES device.list(id) ON DELETE SET NULL;
ALTER TABLE organization.credential_pushes
    ADD CONSTRAINT credential_pushes_logical_device_fk
        FOREIGN KEY (logical_device_id)
        REFERENCES device.list(id) ON DELETE SET NULL;
ALTER TABLE organization.credential_reveal_audit
    ADD CONSTRAINT credential_reveal_logical_device_fk
        FOREIGN KEY (logical_device_id)
        REFERENCES device.list(id) ON DELETE SET NULL;
ALTER TABLE organization.device_credentials
    ADD CONSTRAINT device_credentials_logical_device_fk
        FOREIGN KEY (logical_device_id)
        REFERENCES device.list(id) ON DELETE SET NULL,
    ADD CONSTRAINT device_credentials_retired_reason_chk CHECK (
        (retired_at IS NULL AND retired_reason IS NULL)
        OR (retired_at IS NOT NULL AND retired_reason IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS backup_units_logical_device_idx
    ON organization.backup_units (tenant_id, logical_device_id);
CREATE INDEX IF NOT EXISTS firmware_units_logical_device_idx
    ON organization.firmware_units (tenant_id, logical_device_id);
CREATE INDEX IF NOT EXISTS certificate_pushes_logical_device_idx
    ON organization.certificate_pushes (tenant_id, logical_device_id, slot);
CREATE INDEX IF NOT EXISTS credential_pushes_logical_device_idx
    ON organization.credential_pushes (tenant_id, logical_device_id);
CREATE INDEX IF NOT EXISTS credential_reveal_logical_device_idx
    ON organization.credential_reveal_audit (tenant_id, logical_device_id);
CREATE UNIQUE INDEX IF NOT EXISTS device_credentials_active_logical_device_idx
    ON organization.device_credentials (tenant_id, logical_device_id)
    WHERE retired_at IS NULL;

CREATE OR REPLACE FUNCTION organization.fn_fill_logical_device_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.logical_device_id IS NULL THEN
            NEW.logical_device_id := organization.fn_require_logical_device_id(
                NEW.tenant_id,
                NEW.device_id
            );
        ELSIF NOT EXISTS (
            SELECT 1 FROM device.list d
             WHERE d.id = NEW.logical_device_id
               AND d.organization_id = NEW.tenant_id
               AND d.external_id = NEW.device_id
        ) THEN
            RAISE EXCEPTION 'logical device % does not match %.%',
                NEW.logical_device_id, NEW.tenant_id, NEW.device_id;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.device_id IS DISTINCT FROM OLD.device_id
    THEN
        NEW.logical_device_id := organization.fn_require_logical_device_id(
            NEW.tenant_id,
            NEW.device_id
        );
    ELSIF NEW.logical_device_id IS DISTINCT FROM OLD.logical_device_id
       AND NEW.logical_device_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM device.list d
            WHERE d.id = NEW.logical_device_id
              AND d.organization_id = NEW.tenant_id
       )
    THEN
        RAISE EXCEPTION 'logical device % is not in organization %',
            NEW.logical_device_id, NEW.tenant_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER backup_units_fill_logical_device
BEFORE INSERT OR UPDATE ON organization.backup_units
FOR EACH ROW EXECUTE FUNCTION organization.fn_fill_logical_device_owner();
CREATE TRIGGER firmware_units_fill_logical_device
BEFORE INSERT OR UPDATE ON organization.firmware_units
FOR EACH ROW EXECUTE FUNCTION organization.fn_fill_logical_device_owner();
CREATE TRIGGER certificate_pushes_fill_logical_device
BEFORE INSERT OR UPDATE ON organization.certificate_pushes
FOR EACH ROW EXECUTE FUNCTION organization.fn_fill_logical_device_owner();
CREATE TRIGGER credential_pushes_fill_logical_device
BEFORE INSERT OR UPDATE ON organization.credential_pushes
FOR EACH ROW EXECUTE FUNCTION organization.fn_fill_logical_device_owner();
CREATE TRIGGER credential_reveal_fill_logical_device
BEFORE INSERT OR UPDATE ON organization.credential_reveal_audit
FOR EACH ROW EXECUTE FUNCTION organization.fn_fill_logical_device_owner();
CREATE TRIGGER device_credentials_fill_logical_device
BEFORE INSERT OR UPDATE ON organization.device_credentials
FOR EACH ROW EXECUTE FUNCTION organization.fn_fill_logical_device_owner();

CREATE OR REPLACE FUNCTION organization.fn_stop_device_work_before_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_reason VARCHAR := CASE
        WHEN TG_OP = 'DELETE' THEN 'device_deleted'
        ELSE 'organization_transfer'
    END;
BEGIN
    IF OLD.organization_id IS NULL
       OR (TG_OP = 'UPDATE'
           AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id)
    THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM organization.backup_units
         WHERE tenant_id = OLD.organization_id
           AND logical_device_id = OLD.id
           AND status = 'in_progress'
    ) OR EXISTS (
        SELECT 1 FROM organization.firmware_units
         WHERE tenant_id = OLD.organization_id
           AND logical_device_id = OLD.id
           AND status = 'in_progress'
    ) OR EXISTS (
        SELECT 1 FROM organization.certificate_pushes
         WHERE tenant_id = OLD.organization_id
           AND logical_device_id = OLD.id
           AND status = 'in_progress'
    ) OR EXISTS (
        SELECT 1 FROM organization.credential_pushes
         WHERE tenant_id = OLD.organization_id
           AND logical_device_id = OLD.id
           AND status = 'in_progress'
    ) THEN
        RAISE EXCEPTION 'device lifecycle change blocked by in-progress work';
    END IF;

    UPDATE organization.backup_units
       SET status = 'failed',
           phase = 'failed',
           last_error = v_reason,
           finished_at = now()
     WHERE tenant_id = OLD.organization_id
       AND logical_device_id = OLD.id
       AND status = 'queued';

    UPDATE organization.firmware_units
       SET status = 'failed',
           phase = 'failed',
           last_error = v_reason,
           finished_at = now()
     WHERE tenant_id = OLD.organization_id
       AND logical_device_id = OLD.id
       AND status = 'queued';

    UPDATE organization.certificate_pushes
       SET status = 'failed',
           last_error = v_reason
     WHERE tenant_id = OLD.organization_id
       AND logical_device_id = OLD.id
       AND status = 'queued';

    UPDATE organization.credential_pushes
       SET status = 'failed',
           last_error = v_reason
     WHERE tenant_id = OLD.organization_id
       AND logical_device_id = OLD.id
       AND status = 'queued';

    UPDATE organization.device_credentials
       SET retired_at = now(),
           retired_reason = v_reason
     WHERE tenant_id = OLD.organization_id
       AND logical_device_id = OLD.id
       AND retired_at IS NULL;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER device_stop_work_before_org_transfer
BEFORE UPDATE OF organization_id ON device.list
FOR EACH ROW EXECUTE FUNCTION
    organization.fn_stop_device_work_before_transfer();
CREATE TRIGGER device_stop_work_before_delete
BEFORE DELETE ON device.list
FOR EACH ROW EXECUTE FUNCTION
    organization.fn_stop_device_work_before_transfer();

-- Called by device.fn_replace_hardware before the temporary row is deleted.
-- Historical rows keep their hardware snapshot and move only their owner.
CREATE OR REPLACE FUNCTION organization.fn_reassign_device_ownership(
    p_tenant_id VARCHAR,
    p_retained_device_id INT,
    p_temporary_device_id INT,
    p_new_external_id VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE id = p_retained_device_id
           AND organization_id = p_tenant_id
    ) OR NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE id = p_temporary_device_id
           AND organization_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'replacement devices must belong to organization %',
            p_tenant_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM organization.backup_units
         WHERE tenant_id = p_tenant_id
           AND logical_device_id IN (
               p_retained_device_id, p_temporary_device_id
           )
           AND status = 'in_progress'
    ) OR EXISTS (
        SELECT 1 FROM organization.firmware_units
         WHERE tenant_id = p_tenant_id
           AND logical_device_id IN (
               p_retained_device_id, p_temporary_device_id
           )
           AND status = 'in_progress'
    ) OR EXISTS (
        SELECT 1 FROM organization.certificate_pushes
         WHERE tenant_id = p_tenant_id
           AND logical_device_id IN (
               p_retained_device_id, p_temporary_device_id
           )
           AND status = 'in_progress'
    ) OR EXISTS (
        SELECT 1 FROM organization.credential_pushes
         WHERE tenant_id = p_tenant_id
           AND logical_device_id IN (
               p_retained_device_id, p_temporary_device_id
           )
           AND status = 'in_progress'
    ) THEN
        RAISE EXCEPTION 'device replacement blocked by in-progress work';
    END IF;

    DELETE FROM organization.group_members temporary
     WHERE temporary.organization_id = p_tenant_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM organization.group_members retained
            WHERE retained.organization_id = p_tenant_id
              AND retained.device_id = p_retained_device_id
              AND retained.group_id = temporary.group_id
              AND retained.subject_type = temporary.subject_type
              AND retained.subject_id IS NOT DISTINCT FROM temporary.subject_id
              AND retained.entity_suffix IS NOT DISTINCT FROM temporary.entity_suffix
       );
    UPDATE organization.group_members
       SET device_id = p_retained_device_id
     WHERE organization_id = p_tenant_id
       AND device_id = p_temporary_device_id;

    DELETE FROM organization.tag_assignments temporary
     WHERE temporary.organization_id = p_tenant_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM organization.tag_assignments retained
            WHERE retained.organization_id = p_tenant_id
              AND retained.device_id = p_retained_device_id
              AND retained.tag_id = temporary.tag_id
              AND retained.subject_type = temporary.subject_type
              AND retained.subject_id IS NOT DISTINCT FROM temporary.subject_id
              AND retained.entity_suffix IS NOT DISTINCT FROM temporary.entity_suffix
       );
    UPDATE organization.tag_assignments
       SET device_id = p_retained_device_id
     WHERE organization_id = p_tenant_id
       AND device_id = p_temporary_device_id;

    DELETE FROM organization.location_assignments temporary
     WHERE temporary.organization_id = p_tenant_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM organization.location_assignments retained
            WHERE retained.organization_id = p_tenant_id
              AND retained.device_id = p_retained_device_id
              AND retained.subject_type = temporary.subject_type
              AND retained.subject_id IS NOT DISTINCT FROM temporary.subject_id
              AND retained.entity_suffix IS NOT DISTINCT FROM temporary.entity_suffix
       );
    UPDATE organization.location_assignments
       SET device_id = p_retained_device_id
     WHERE organization_id = p_tenant_id
       AND device_id = p_temporary_device_id;

    DELETE FROM organization.assignment_device_scope temporary
     WHERE temporary.tenant_id = p_tenant_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM organization.assignment_device_scope retained
            WHERE retained.tenant_id = p_tenant_id
              AND retained.device_id = p_retained_device_id
              AND retained.assignment_id = temporary.assignment_id
       );
    UPDATE organization.assignment_device_scope
       SET device_id = p_retained_device_id
     WHERE tenant_id = p_tenant_id
       AND device_id = p_temporary_device_id;

    DELETE FROM organization.tariff_assignment temporary
     WHERE temporary.organization_id = p_tenant_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM organization.tariff_assignment retained
            WHERE retained.organization_id = p_tenant_id
              AND retained.device_id = p_retained_device_id
              AND retained.scope_level = temporary.scope_level
              AND retained.dashboard_id IS NOT DISTINCT FROM temporary.dashboard_id
              AND retained.channel IS NOT DISTINCT FROM temporary.channel
       );
    UPDATE organization.tariff_assignment
       SET device_id = p_retained_device_id
     WHERE organization_id = p_tenant_id
       AND device_id = p_temporary_device_id;

    UPDATE organization.backup_units
       SET device_id = p_new_external_id
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_retained_device_id
       AND status = 'queued';
    UPDATE organization.firmware_units
       SET device_id = p_new_external_id
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_retained_device_id
       AND status = 'queued';
    UPDATE organization.certificate_pushes
       SET device_id = p_new_external_id
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_retained_device_id
       AND status = 'queued';
    UPDATE organization.credential_pushes
       SET device_id = p_new_external_id
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_retained_device_id
       AND status = 'queued';

    UPDATE organization.backup_units
       SET logical_device_id = p_retained_device_id,
           device_id = CASE WHEN status = 'queued'
               THEN p_new_external_id ELSE device_id END
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_temporary_device_id;
    UPDATE organization.firmware_units
       SET logical_device_id = p_retained_device_id,
           device_id = CASE WHEN status = 'queued'
               THEN p_new_external_id ELSE device_id END
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_temporary_device_id;
    UPDATE organization.certificate_pushes
       SET logical_device_id = p_retained_device_id,
           device_id = CASE WHEN status = 'queued'
               THEN p_new_external_id ELSE device_id END
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_temporary_device_id;
    UPDATE organization.credential_pushes
       SET logical_device_id = p_retained_device_id,
           device_id = CASE WHEN status = 'queued'
               THEN p_new_external_id ELSE device_id END
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_temporary_device_id;
    UPDATE organization.credential_reveal_audit
       SET logical_device_id = p_retained_device_id
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_temporary_device_id;

    -- Credentials describe hardware state. Retire the old hardware first so
    -- the new hardware can become the one active credential without conflict.
    UPDATE organization.device_credentials
       SET retired_at = now(),
           retired_reason = 'hardware_replacement'
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_retained_device_id
       AND retired_at IS NULL;

    UPDATE organization.device_credentials
       SET logical_device_id = p_retained_device_id
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = p_temporary_device_id;
END;
$$;

--------------DOWN
-- Forward-only logical identity migration.
