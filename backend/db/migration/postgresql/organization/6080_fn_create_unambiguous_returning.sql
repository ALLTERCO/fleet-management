--------------UP
-- PG 17 plpgsql rejects bare column refs in INSERT ... RETURNING when the
-- function RETURNS TABLE declares OUT parameters with the same names
-- (`column reference "id" is ambiguous`). Fix: INSERT RETURNING INTO a
-- %ROWTYPE variable, then SELECT explicit fields — no ambiguity possible.
-- Applies to every Create fn that uses INSERT...RETURNING with a RETURNS TABLE
-- whose columns overlap the target table's columns.

-- ---- fn_group_create -------------------------------------------------------
CREATE OR REPLACE FUNCTION organization.fn_group_create(
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_parent_group_id INTEGER DEFAULT NULL,
    p_group_type      VARCHAR DEFAULT 'standard',
    p_metadata        JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
    name              VARCHAR,
    description       VARCHAR,
    parent_group_id   INTEGER,
    group_type        VARCHAR,
    membership_mode   VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row organization.groups%ROWTYPE;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF p_parent_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.groups g
        WHERE g.id = p_parent_group_id
          AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'parent_group_id % not found in organization %',
            p_parent_group_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'GroupParentNotFound';
    END IF;

    INSERT INTO organization.groups (
        organization_id, name, description, parent_group_id,
        group_type, metadata
    )
    VALUES (
        p_organization_id, p_name, p_description, p_parent_group_id,
        COALESCE(p_group_type, 'standard'),
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_row;

    RETURN QUERY SELECT
        v_row.id, v_row.organization_id, v_row.name, v_row.description,
        v_row.parent_group_id, v_row.group_type, v_row.membership_mode,
        v_row.metadata, v_row.created_at, v_row.updated_at;
END;
$$;

-- ---- fn_tag_create ---------------------------------------------------------
CREATE OR REPLACE FUNCTION organization.fn_tag_create(
    p_organization_id VARCHAR,
    p_key             VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_color           VARCHAR DEFAULT NULL,
    p_icon            VARCHAR DEFAULT NULL,
    p_metadata        JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row organization.tags%ROWTYPE;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    INSERT INTO organization.tags (
        organization_id, key, name, description, color, icon, metadata
    )
    VALUES (
        p_organization_id, p_key, p_name, p_description, p_color, p_icon,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_row;

    RETURN QUERY SELECT
        v_row.id, v_row.organization_id, v_row.key, v_row.name,
        v_row.description, v_row.color, v_row.icon, v_row.metadata,
        v_row.created_at, v_row.updated_at;
END;
$$;

-- ---- fn_location_create ----------------------------------------------------
CREATE OR REPLACE FUNCTION organization.fn_location_create(
    p_organization_id   VARCHAR,
    p_name              VARCHAR,
    p_kind              VARCHAR,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_sort_order        INTEGER DEFAULT 0,
    p_timezone          VARCHAR DEFAULT NULL,
    p_address           JSONB   DEFAULT NULL,
    p_location_code     VARCHAR DEFAULT NULL,
    p_geo               JSONB   DEFAULT NULL,
    p_metadata          JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    name                VARCHAR,
    kind                VARCHAR,
    parent_location_id  INTEGER,
    sort_order          INTEGER,
    timezone            VARCHAR,
    address             JSONB,
    location_code       VARCHAR,
    geo                 JSONB,
    metadata            JSONB,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row organization.locations%ROWTYPE;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF p_parent_location_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.locations l
        WHERE l.id = p_parent_location_id
          AND l.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'parent_location_id % not found in organization %',
            p_parent_location_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'LocationParentNotFound';
    END IF;

    INSERT INTO organization.locations (
        organization_id, name, kind, parent_location_id, sort_order,
        timezone, address, location_code, geo, metadata
    )
    VALUES (
        p_organization_id, p_name, p_kind, p_parent_location_id,
        COALESCE(p_sort_order, 0),
        p_timezone, p_address, p_location_code, p_geo,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_row;

    RETURN QUERY SELECT
        v_row.id, v_row.organization_id, v_row.name, v_row.kind,
        v_row.parent_location_id, v_row.sort_order, v_row.timezone,
        v_row.address, v_row.location_code, v_row.geo, v_row.metadata,
        v_row.created_at, v_row.updated_at;
END;
$$;
--------------DOWN
-- No rollback body — the pre-fix versions in 6040 / 6030 / 6010 / 6060 remain
-- on disk and would be re-applied by their own DOWNs. This fix is forward-only.
