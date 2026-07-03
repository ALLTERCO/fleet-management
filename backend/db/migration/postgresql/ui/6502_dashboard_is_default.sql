--------------UP
ALTER TABLE ui.dashboard ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX dashboard_one_default_per_org
    ON ui.dashboard (organization_id) WHERE is_default;
--------------DOWN
DROP INDEX IF EXISTS ui.dashboard_one_default_per_org;
ALTER TABLE ui.dashboard DROP COLUMN is_default;
