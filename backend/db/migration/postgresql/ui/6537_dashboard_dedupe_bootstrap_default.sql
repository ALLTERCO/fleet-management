--------------UP
-- Clean up duplicate "Default Dashboard" rows produced by the bootstrap
-- race in fn_profile_ensure (fixed in organization/6005). Conservative
-- match: only rows that look like fresh bootstrap output —
--   * same (organization_id, name, dashboard_type) tuple
--   * scope columns all NULL (location_id, group_id, tag_id)
--   * zero items
-- Keep the oldest row per tuple; delete the duplicates. User-renamed or
-- populated dashboards are untouched.
WITH bootstrap_dupes AS (
    SELECT d.id,
           ROW_NUMBER() OVER (
               PARTITION BY d.organization_id, d.name, d.dashboard_type
               ORDER BY d.created ASC, d.id ASC
           ) AS rn,
           COUNT(*) OVER (
               PARTITION BY d.organization_id, d.name, d.dashboard_type
           ) AS cnt
      FROM ui.dashboard d
     WHERE d.location_id IS NULL
       AND d.group_id IS NULL
       AND d.tag_id IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM ui.dashboard_item i WHERE i.dashboard = d.id
       )
)
DELETE FROM ui.dashboard
 WHERE id IN (
    SELECT id FROM bootstrap_dupes WHERE rn > 1 AND cnt > 1
 );

-- Reseat defaults via the canonical function (6537). Single source of
-- truth — same logic as the historical 6533 backfill.
SELECT ui.fn_dashboard_seed_default_per_org();
--------------DOWN
-- One-shot cleanup. No restore — deleted rows were duplicate bootstraps
-- with no items and no scope; the surviving row carries the same name
-- and type. is_default flag carry-over is intentional.
SELECT 1;
