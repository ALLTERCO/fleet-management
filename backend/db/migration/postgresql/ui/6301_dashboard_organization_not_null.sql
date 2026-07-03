--------------UP
-- Legacy dashboards predate organization_id. Preserve them by assigning
-- ownership before the NOT NULL guard: scoped dashboards inherit their
-- migrated group org, unscoped dashboards fall back to the first profile.
INSERT INTO organization.profile (id, name, display_name, metadata)
SELECT
    'legacy',
    'Legacy',
    'Legacy',
    jsonb_build_object('legacySource', 'ui.dashboard')
WHERE EXISTS (SELECT 1 FROM ui.dashboard WHERE organization_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM organization.profile);

WITH fallback_org AS (
    SELECT id AS organization_id
      FROM organization.profile
     ORDER BY CASE WHEN id = 'legacy' THEN 1 ELSE 0 END, id
     LIMIT 1
),
dashboard_org AS (
    SELECT
        d.id AS dashboard_id,
        COALESCE(g.organization_id, fallback_org.organization_id) AS organization_id
      FROM ui.dashboard d
      CROSS JOIN fallback_org
      LEFT JOIN organization.groups g
        ON g.id = d.group_id
     WHERE d.organization_id IS NULL
)
UPDATE ui.dashboard d
   SET organization_id = dashboard_org.organization_id
  FROM dashboard_org
 WHERE d.id = dashboard_org.dashboard_id;

-- Drop only unrecoverable NULL-org rows and enforce NOT NULL so future bugs
-- cannot write another orphan. Dashboard items cascade-delete via FK.
DELETE FROM ui.dashboard_item
WHERE dashboard IN (SELECT id FROM ui.dashboard WHERE organization_id IS NULL);

DELETE FROM ui.dashboard WHERE organization_id IS NULL;

ALTER TABLE ui.dashboard
    ALTER COLUMN organization_id SET NOT NULL;
--------------DOWN
ALTER TABLE ui.dashboard
    ALTER COLUMN organization_id DROP NOT NULL;
