--------------UP
-- The gate: an ALLOWED device must have an owning org. Enforced by the schema
-- so every path — admit, ingress, auto-admit, virtual-device, manual SQL,
-- future code — fails loud at write time instead of silently orphaning a
-- device (invisible to its tenant). external_id IS NULL is exempt: those are
-- internal rows that never pass through the admit/accept flow.

-- Heal any legacy orphan before validating: reset trusted-but-org-less devices
-- to pending so they re-enter the waiting room and get re-accepted with their
-- org. On a clean DB this updates nothing.
UPDATE device.list
   SET control_access = 1,
       updated = NOW()
 WHERE control_access = 3
   AND organization_id IS NULL
   AND external_id IS NOT NULL;

ALTER TABLE device.list
    ADD CONSTRAINT device_list_allowed_has_org
    CHECK (
        control_access <> 3
        OR organization_id IS NOT NULL
        OR external_id IS NULL
    );
--------------DOWN
ALTER TABLE device.list
    DROP CONSTRAINT IF EXISTS device_list_allowed_has_org;
