--------------UP
-- Extend the location case of the single scope resolver: a location's device
-- set is now its directly-assigned devices UNION the member devices of any
-- group assigned to it. All other scope kinds are unchanged.
CREATE OR REPLACE FUNCTION device.fn_resolve_scope(
    p_org_id      VARCHAR,
    p_scope_kind  TEXT,
    p_scope_id    INTEGER DEFAULT NULL
)
RETURNS TABLE (
    dev_id      INTEGER,
    shelly_id   VARCHAR,
    scope_kind  TEXT,
    scope_id    INTEGER,
    scope_name  TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_scope_kind = 'fleet' THEN
        RETURN QUERY
        SELECT
            dl.id              AS dev_id,
            dl.external_id     AS shelly_id,
            'fleet'::TEXT      AS scope_kind,
            NULL::INTEGER      AS scope_id,
            'Fleet'::TEXT      AS scope_name
        FROM device.list dl
        WHERE dl.organization_id = p_org_id
          AND dl.external_id IS NOT NULL;
        RETURN;
    END IF;

    IF p_scope_id IS NULL THEN
        RAISE EXCEPTION 'fn_resolve_scope: p_scope_id required for kind=%', p_scope_kind;
    END IF;

    IF p_scope_kind = 'group' THEN
        RETURN QUERY
        SELECT
            dl.id              AS dev_id,
            dl.external_id     AS shelly_id,
            'group'::TEXT      AS scope_kind,
            g.id               AS scope_id,
            g.name::TEXT       AS scope_name
        FROM organization.groups g
        JOIN organization.group_members gm
          ON gm.organization_id = g.organization_id
         AND gm.group_id = g.id
         AND gm.subject_type = 'device'
        JOIN device.list dl
          ON dl.organization_id = g.organization_id
         AND dl.external_id = gm.subject_id
        WHERE g.organization_id = p_org_id
          AND g.id = p_scope_id;
        RETURN;
    END IF;

    IF p_scope_kind = 'location' THEN
        RETURN QUERY
        -- devices assigned directly to the location
        SELECT
            dl.id              AS dev_id,
            dl.external_id     AS shelly_id,
            'location'::TEXT   AS scope_kind,
            loc.id             AS scope_id,
            loc.name::TEXT     AS scope_name
        FROM organization.locations loc
        JOIN organization.location_assignments la
          ON la.organization_id = loc.organization_id
         AND la.location_id = loc.id
         AND la.subject_type = 'device'
        JOIN device.list dl
          ON dl.organization_id = loc.organization_id
         AND dl.external_id = la.subject_id
        WHERE loc.organization_id = p_org_id
          AND loc.id = p_scope_id
        UNION
        -- member devices of a group assigned to the location
        SELECT
            dl.id              AS dev_id,
            dl.external_id     AS shelly_id,
            'location'::TEXT   AS scope_kind,
            loc.id             AS scope_id,
            loc.name::TEXT     AS scope_name
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
          AND loc.id = p_scope_id;
        RETURN;
    END IF;

    IF p_scope_kind = 'tag' THEN
        RETURN QUERY
        SELECT
            dl.id              AS dev_id,
            dl.external_id     AS shelly_id,
            'tag'::TEXT        AS scope_kind,
            t.id               AS scope_id,
            t.name::TEXT       AS scope_name
        FROM organization.tags t
        JOIN organization.tag_assignments ta
          ON ta.organization_id = t.organization_id
         AND ta.tag_id = t.id
         AND ta.subject_type = 'device'
        JOIN device.list dl
          ON dl.organization_id = t.organization_id
         AND dl.external_id = ta.subject_id
        WHERE t.organization_id = p_org_id
          AND t.id = p_scope_id;
        RETURN;
    END IF;

    RAISE EXCEPTION 'fn_resolve_scope: unknown p_scope_kind=%', p_scope_kind;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_resolve_scope(VARCHAR, TEXT, INTEGER);
