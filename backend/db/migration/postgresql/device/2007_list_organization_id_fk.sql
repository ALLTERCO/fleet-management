--------------UP
-- Bind device.list.organization_id to organization.profile.
-- Null orphan rows whose org_id no longer matches any profile.
UPDATE device.list
   SET organization_id = NULL
 WHERE organization_id IS NOT NULL
   AND organization_id NOT IN (SELECT id FROM organization.profile);

ALTER TABLE device.list
    ADD CONSTRAINT device_list_organization_id_fk
    FOREIGN KEY (organization_id)
    REFERENCES organization.profile(id)
    ON DELETE SET NULL;

--------------DOWN
ALTER TABLE device.list
    DROP CONSTRAINT IF EXISTS device_list_organization_id_fk;
