--------------UP
-- Adds same-org parent validation.
DROP FUNCTION IF EXISTS organization.fn_location_create(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR, JSONB, VARCHAR, JSONB, JSONB);
CREATE OR REPLACE FUNCTION organization.fn_location_create(
    p_organization_id    VARCHAR,
    p_name               VARCHAR,
    p_kind               VARCHAR,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_sort_order         INTEGER DEFAULT 0,
    p_timezone           VARCHAR DEFAULT NULL,
    p_address            JSONB   DEFAULT NULL,
    p_location_code      VARCHAR DEFAULT NULL,
    p_geo                JSONB   DEFAULT NULL,
    p_metadata           JSONB   DEFAULT '{}'::jsonb
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
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF p_parent_location_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM organization.locations
            WHERE id = p_parent_location_id
              AND organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'parent_location_id % not found in organization %',
                p_parent_location_id, p_organization_id
                USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN QUERY
    INSERT INTO organization.locations (
        organization_id, name, kind, parent_location_id, sort_order,
        timezone, address, location_code, geo, metadata
    )
    VALUES (
        p_organization_id, p_name, p_kind, p_parent_location_id, COALESCE(p_sort_order, 0),
        p_timezone, p_address, p_location_code, p_geo, COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING locations.id, locations.organization_id, locations.name, locations.kind,
              locations.parent_location_id, locations.sort_order, locations.timezone,
              locations.address, locations.location_code, locations.geo, locations.metadata,
              locations.created_at, locations.updated_at;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_create(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR, JSONB, VARCHAR, JSONB, JSONB);
CREATE OR REPLACE FUNCTION organization.fn_location_create(
    p_organization_id    VARCHAR,
    p_name               VARCHAR,
    p_kind               VARCHAR,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_sort_order         INTEGER DEFAULT 0,
    p_timezone           VARCHAR DEFAULT NULL,
    p_address            JSONB   DEFAULT NULL,
    p_location_code      VARCHAR DEFAULT NULL,
    p_geo                JSONB   DEFAULT NULL,
    p_metadata           JSONB   DEFAULT '{}'::jsonb
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
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    RETURN QUERY
    INSERT INTO organization.locations (
        organization_id, name, kind, parent_location_id, sort_order,
        timezone, address, location_code, geo, metadata
    )
    VALUES (
        p_organization_id, p_name, p_kind, p_parent_location_id, COALESCE(p_sort_order, 0),
        p_timezone, p_address, p_location_code, p_geo, COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING locations.id, locations.organization_id, locations.name, locations.kind,
              locations.parent_location_id, locations.sort_order, locations.timezone,
              locations.address, locations.location_code, locations.geo, locations.metadata,
              locations.created_at, locations.updated_at;
END;
$$;
