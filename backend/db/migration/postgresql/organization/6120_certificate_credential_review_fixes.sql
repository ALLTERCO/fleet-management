--------------UP
-- Review-pass fixes on top of 6118 + 6119.
-- Idempotent; safe to apply on top of partial deployments.

SET search_path TO organization;

-- 4: superseded_by FK + ON DELETE SET NULL.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'certificates_superseded_by_fkey'
    ) THEN
        ALTER TABLE certificates
        ADD CONSTRAINT certificates_superseded_by_fkey
            FOREIGN KEY (superseded_by) REFERENCES certificates(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- 5: certificate_pushes status partial index.
CREATE INDEX IF NOT EXISTS certificate_pushes_status_idx
    ON certificate_pushes (status, id)
 WHERE status IN ('queued', 'in_progress');

-- 7: tenant_id on push tables. Backfill from parent job, then enforce NOT NULL.
ALTER TABLE certificate_pushes
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(120);
UPDATE certificate_pushes p
   SET tenant_id = j.tenant_id
  FROM certificate_jobs j
 WHERE p.job_id = j.id AND p.tenant_id IS NULL;
ALTER TABLE certificate_pushes
    ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'certificate_pushes_tenant_id_fkey'
    ) THEN
        ALTER TABLE certificate_pushes
        ADD CONSTRAINT certificate_pushes_tenant_id_fkey
            FOREIGN KEY (tenant_id) REFERENCES organization.profile(id)
            ON DELETE CASCADE;
    END IF;
END $$;
DROP INDEX IF EXISTS organization.certificate_pushes_device_slot_idx;
CREATE INDEX IF NOT EXISTS certificate_pushes_tenant_device_slot_idx
    ON certificate_pushes (tenant_id, device_id, slot);

ALTER TABLE credential_pushes
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(120);
UPDATE credential_pushes p
   SET tenant_id = j.tenant_id
  FROM credential_jobs j
 WHERE p.job_id = j.id AND p.tenant_id IS NULL;
ALTER TABLE credential_pushes
    ALTER COLUMN tenant_id SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'credential_pushes_tenant_id_fkey'
    ) THEN
        ALTER TABLE credential_pushes
        ADD CONSTRAINT credential_pushes_tenant_id_fkey
            FOREIGN KEY (tenant_id) REFERENCES organization.profile(id)
            ON DELETE CASCADE;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS credential_pushes_tenant_device_idx
    ON credential_pushes (tenant_id, device_id);

-- 8: split applied_at semantic. picked_up_at = worker pickup, applied_at = device-applied.
ALTER TABLE certificate_pushes
    ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;
UPDATE certificate_pushes
   SET picked_up_at = applied_at
 WHERE picked_up_at IS NULL
   AND status IN ('in_progress', 'failed', 'rolled_back')
   AND applied_at IS NOT NULL;
COMMENT ON COLUMN certificate_pushes.picked_up_at
    IS 'Set when worker transitions row to in_progress.';
COMMENT ON COLUMN certificate_pushes.applied_at
    IS 'Set only when status becomes applied (cert lives on the device).';

-- 9: cap justification length.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'credential_reveal_audit_justification_length'
    ) THEN
        ALTER TABLE credential_reveal_audit
        ADD CONSTRAINT credential_reveal_audit_justification_length
            CHECK (justification IS NULL OR length(justification) <= 500);
    END IF;
END $$;

--------------DOWN
SET search_path TO organization;

ALTER TABLE credential_reveal_audit
    DROP CONSTRAINT IF EXISTS credential_reveal_audit_justification_length;

ALTER TABLE certificate_pushes DROP COLUMN IF EXISTS picked_up_at;

DROP INDEX IF EXISTS organization.credential_pushes_tenant_device_idx;
ALTER TABLE credential_pushes
    DROP CONSTRAINT IF EXISTS credential_pushes_tenant_id_fkey;
ALTER TABLE credential_pushes DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS organization.certificate_pushes_tenant_device_slot_idx;
CREATE INDEX IF NOT EXISTS certificate_pushes_device_slot_idx
    ON certificate_pushes (device_id, slot);
ALTER TABLE certificate_pushes
    DROP CONSTRAINT IF EXISTS certificate_pushes_tenant_id_fkey;
ALTER TABLE certificate_pushes DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS organization.certificate_pushes_status_idx;

ALTER TABLE certificates
    DROP CONSTRAINT IF EXISTS certificates_superseded_by_fkey;
