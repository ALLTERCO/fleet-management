--------------UP
-- Shared cross-org + existence validator for dashboard scope axes.
-- Used by both fn_dashboard_add_scoped and fn_dashboard_update so the
-- rule lives in one place. Raises 22023 / CrossOrgReference on mismatch.
CREATE OR REPLACE FUNCTION ui.fn_dashboard_assert_scope_valid(
    p_organization_id VARCHAR,
    p_location_id     INTEGER,
    p_group_id        INTEGER,
    p_tag_id          INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_location_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.locations l
        WHERE l.id = p_location_id AND l.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'CrossOrgReference';
    END IF;

    IF p_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.groups g
        WHERE g.id = p_group_id AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'CrossOrgReference';
    END IF;

    IF p_tag_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.tags t
        WHERE t.id = p_tag_id AND t.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'CrossOrgReference';
    END IF;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_assert_scope_valid(VARCHAR, INTEGER, INTEGER, INTEGER);
