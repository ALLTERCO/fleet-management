--------------UP
-- System profiles live at organization_id IS NULL (shared starter catalog,
-- see 6570). The original composite FK (profile_id, organization_id) can only
-- match a same-org profile, so any device created from a system profile fails
-- the FK. Reference virtual_device_profile(id) alone — id is the table PK, so
-- existence is still guaranteed. Tenant scoping (same-org or system) is
-- enforced in the create path.
SET search_path TO device;

ALTER TABLE device.virtual_device
    DROP CONSTRAINT virtual_device_profile_org_fk;

ALTER TABLE device.virtual_device
    ADD CONSTRAINT virtual_device_profile_id_fk FOREIGN KEY (profile_id)
        REFERENCES device.virtual_device_profile(id)
        ON DELETE SET NULL;

--------------DOWN
SET search_path TO device;

-- Devices referencing a system (NULL-org) profile cannot satisfy the
-- composite FK; null them so the constraint can be restored.
UPDATE device.virtual_device d
   SET profile_id = NULL
  FROM device.virtual_device_profile p
 WHERE d.profile_id = p.id
   AND p.organization_id IS DISTINCT FROM d.organization_id;

ALTER TABLE device.virtual_device
    DROP CONSTRAINT virtual_device_profile_id_fk;

ALTER TABLE device.virtual_device
    ADD CONSTRAINT virtual_device_profile_org_fk FOREIGN KEY (profile_id, organization_id)
        REFERENCES device.virtual_device_profile(id, organization_id)
        ON DELETE SET NULL (profile_id);
