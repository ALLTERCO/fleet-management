--------------UP
-- Slice E dropped device.groups (+ its FK) with CASCADE. Re-home ui.dashboard
-- scope columns on the new organization.* tables and introduce location/tag scope.
-- organization_id is nullable to keep the legacy bootstrap (Registry.ts seed) working;
-- frontend migration will stamp it on every new dashboard via Dashboard.Create.

ALTER TABLE ui.dashboard
    ADD COLUMN organization_id VARCHAR(120)
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    ADD COLUMN location_id INTEGER
        REFERENCES organization.locations(id) ON DELETE SET NULL,
    ADD COLUMN tag_id INTEGER
        REFERENCES organization.tags(id) ON DELETE SET NULL,
    ADD CONSTRAINT dashboard_group_fk
        FOREIGN KEY (group_id) REFERENCES organization.groups(id) ON DELETE SET NULL,
    ADD CONSTRAINT dashboard_scope_single_axis CHECK (
        (CASE WHEN location_id IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN group_id    IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN tag_id      IS NOT NULL THEN 1 ELSE 0 END) <= 1
    );

CREATE INDEX ui_dashboard_organization ON ui.dashboard (organization_id);
CREATE INDEX ui_dashboard_location ON ui.dashboard (location_id);
CREATE INDEX ui_dashboard_tag ON ui.dashboard (tag_id);

--------------DOWN
DROP INDEX IF EXISTS ui_dashboard_tag;
DROP INDEX IF EXISTS ui_dashboard_location;
DROP INDEX IF EXISTS ui_dashboard_organization;
ALTER TABLE ui.dashboard
    DROP CONSTRAINT IF EXISTS dashboard_scope_single_axis,
    DROP CONSTRAINT IF EXISTS dashboard_group_fk,
    DROP COLUMN IF EXISTS tag_id,
    DROP COLUMN IF EXISTS location_id,
    DROP COLUMN IF EXISTS organization_id;
