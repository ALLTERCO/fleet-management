--------------UP
-- group_id column without FK; FK to organization.groups is added by 6300.
-- History note: original 2100 FK'd to device.groups, which was later dropped
-- CASCADE by device/2005_drop_legacy_groups.sql. On fresh deploys that
-- migration drops the table before this one runs, so the FK can't be created
-- here. Keep the column so 6300 has something to re-home.
ALTER TABLE ui.dashboard
ADD COLUMN group_id INTEGER NULL,
ADD COLUMN dashboard_type VARCHAR(20) DEFAULT 'classic' CHECK (dashboard_type IN ('classic', 'analytics'));

CREATE INDEX ui_dashboard_group_id ON ui.dashboard (group_id);
--------------DOWN
DROP INDEX IF EXISTS ui_dashboard_group_id;
ALTER TABLE ui.dashboard DROP COLUMN IF EXISTS group_id;
ALTER TABLE ui.dashboard DROP COLUMN IF EXISTS dashboard_type;
