--------------UP
-- Batched location-scope resolver — many location ids to device shelly_ids.
CREATE OR REPLACE FUNCTION device.fn_resolve_scope_locations(
    p_org_id        VARCHAR,
    p_location_ids  INTEGER[]
)
RETURNS TABLE (
    scope_id    INTEGER,
    shelly_id   VARCHAR
)
LANGUAGE sql
AS $$
    SELECT
        loc.id          AS scope_id,
        dl.external_id  AS shelly_id
    FROM organization.locations loc
    JOIN organization.location_assignments la
      ON la.organization_id = loc.organization_id
     AND la.location_id = loc.id
     AND la.subject_type = 'device'
    JOIN device.list dl
      ON dl.organization_id = loc.organization_id
     AND dl.external_id = la.subject_id
    WHERE loc.organization_id = p_org_id
      AND loc.id = ANY(p_location_ids)
    UNION
    SELECT
        loc.id          AS scope_id,
        dl.external_id  AS shelly_id
    FROM organization.locations loc
    JOIN organization.location_assignments la
      ON la.organization_id = loc.organization_id
     AND la.location_id = loc.id
     AND la.subject_type = 'group'
    JOIN organization.group_members gm
      ON gm.organization_id = loc.organization_id
     AND gm.group_id::TEXT = la.subject_id
     AND gm.subject_type = 'device'
    JOIN device.list dl
      ON dl.organization_id = loc.organization_id
     AND dl.external_id = gm.subject_id
    WHERE loc.organization_id = p_org_id
      AND loc.id = ANY(p_location_ids);
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_resolve_scope_locations(VARCHAR, INTEGER[]);
