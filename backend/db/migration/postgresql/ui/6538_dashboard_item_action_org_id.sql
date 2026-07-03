--------------UP
-- Phase 1: add org column for action rows. Nullable until phase 3.
ALTER TABLE ui.dashboard_item_action
    ADD COLUMN organization_id VARCHAR(120)
        REFERENCES organization.profile(id) ON DELETE CASCADE;

UPDATE ui.dashboard_item_action a
   SET organization_id = sub.organization_id
  FROM (
      SELECT DISTINCT ON (di.item) di.item AS action_id, d.organization_id
        FROM ui.dashboard_item di
        JOIN ui.dashboard d ON d.id = di.dashboard
       WHERE di.kind = 'action' AND d.organization_id IS NOT NULL
       ORDER BY di.item, d.id
  ) sub
 WHERE a.id = sub.action_id;

CREATE INDEX dashboard_item_action_org
    ON ui.dashboard_item_action (organization_id);
--------------DOWN
DROP INDEX IF EXISTS ui.dashboard_item_action_org;
ALTER TABLE ui.dashboard_item_action DROP COLUMN organization_id;
