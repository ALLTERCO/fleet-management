--------------UP
-- System-level audit events (e.g. rotate-secrets) have no tenant scope.
-- Allow tenant_id NULL so the same table covers tenant + system events.

SET search_path TO organization;

ALTER TABLE authz_audit ALTER COLUMN tenant_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS authz_audit_system_idx
    ON authz_audit (created_at DESC) WHERE tenant_id IS NULL;

--------------DOWN
SET search_path TO organization;

DROP INDEX IF EXISTS organization.authz_audit_system_idx;

-- Restoring NOT NULL would fail if any system rows exist; clear them first.
DELETE FROM authz_audit WHERE tenant_id IS NULL;
ALTER TABLE authz_audit ALTER COLUMN tenant_id SET NOT NULL;
