--------------UP
-- For orgs that have any dashboards but no is_default yet, mark the
-- oldest one as default so the first-load redirect still works for
-- legacy orgs after the auto-bootstrap retires.
WITH first_per_org AS (
    SELECT DISTINCT ON (organization_id) id, organization_id
      FROM ui.dashboard
     WHERE organization_id IS NOT NULL
     ORDER BY organization_id, created ASC, id ASC
)
UPDATE ui.dashboard d SET is_default = TRUE
  FROM first_per_org f
 WHERE d.id = f.id
   AND NOT EXISTS (
       SELECT 1 FROM ui.dashboard d2
        WHERE d2.organization_id = d.organization_id
          AND d2.is_default = TRUE
   );
--------------DOWN
-- Idempotent — no-op down (we don't reset users' chosen defaults).
SELECT 1;
