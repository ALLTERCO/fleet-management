--------------UP
-- Single source of truth for "ensure each org has exactly one default
-- dashboard". Marks the oldest dashboard as default for any org that
-- has dashboards but none flagged. Idempotent — safe to call any time.
-- Replaces the inline duplicates in 6533 and 6536.
CREATE OR REPLACE FUNCTION ui.fn_dashboard_seed_default_per_org()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    affected INTEGER;
BEGIN
    WITH first_per_org AS (
        SELECT DISTINCT ON (organization_id) id, organization_id
          FROM ui.dashboard
         WHERE organization_id IS NOT NULL
         ORDER BY organization_id, created ASC, id ASC
    ),
    updated AS (
        UPDATE ui.dashboard d SET is_default = TRUE
          FROM first_per_org f
         WHERE d.id = f.id
           AND NOT EXISTS (
               SELECT 1 FROM ui.dashboard d2
                WHERE d2.organization_id = d.organization_id
                  AND d2.is_default = TRUE
           )
        RETURNING d.id
    )
    SELECT COUNT(*) INTO affected FROM updated;
    RETURN affected;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_seed_default_per_org();
