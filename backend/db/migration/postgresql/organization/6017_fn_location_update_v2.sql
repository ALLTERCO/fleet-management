--------------UP
-- Adds same-org parent validation.
DROP FUNCTION IF EXISTS organization.fn_location_update(VARCHAR, INTEGER, VARCHAR, VARCHAR, INTEGER, BOOLEAN, INTEGER, VARCHAR, BOOLEAN, JSONB, VARCHAR, BOOLEAN, JSONB, JSONB);
CREATE OR REPLACE FUNCTION organization.fn_location_update(
    p_organization_id    VARCHAR,
    p_id                 INTEGER,
    p_name               VARCHAR DEFAULT NULL,
    p_kind               VARCHAR DEFAULT NULL,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_clear_parent       BOOLEAN DEFAULT FALSE,
    p_sort_order         INTEGER DEFAULT NULL,
    p_timezone           VARCHAR DEFAULT NULL,
    p_clear_timezone     BOOLEAN DEFAULT FALSE,
    p_address            JSONB   DEFAULT NULL,
    p_location_code      VARCHAR DEFAULT NULL,
    p_clear_code         BOOLEAN DEFAULT FALSE,
    p_geo                JSONB   DEFAULT NULL,
    p_metadata           JSONB   DEFAULT NULL
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
    IF p_parent_location_id IS NOT NULL AND NOT p_clear_parent THEN
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
    UPDATE organization.locations SET
        name               = COALESCE(p_name, locations.name),
        kind               = COALESCE(p_kind, locations.kind),
        parent_location_id = CASE
            WHEN p_clear_parent THEN NULL
            WHEN p_parent_location_id IS NOT NULL THEN p_parent_location_id
            ELSE locations.parent_location_id
        END,
        sort_order         = COALESCE(p_sort_order, locations.sort_order),
        timezone           = CASE
            WHEN p_clear_timezone THEN NULL
            WHEN p_timezone IS NOT NULL THEN p_timezone
            ELSE locations.timezone
        END,
        address            = COALESCE(p_address, locations.address),
        location_code      = CASE
            WHEN p_clear_code THEN NULL
            WHEN p_location_code IS NOT NULL THEN p_location_code
            ELSE locations.location_code
        END,
        geo                = COALESCE(p_geo, locations.geo),
        metadata           = COALESCE(p_metadata, locations.metadata),
        updated_at         = NOW()
    WHERE locations.id = p_id
      AND locations.organization_id = p_organization_id
    RETURNING locations.id, locations.organization_id, locations.name, locations.kind,
              locations.parent_location_id, locations.sort_order, locations.timezone,
              locations.address, locations.location_code, locations.geo, locations.metadata,
              locations.created_at, locations.updated_at;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_update(VARCHAR, INTEGER, VARCHAR, VARCHAR, INTEGER, BOOLEAN, INTEGER, VARCHAR, BOOLEAN, JSONB, VARCHAR, BOOLEAN, JSONB, JSONB);
CREATE OR REPLACE FUNCTION organization.fn_location_update(
    p_organization_id    VARCHAR,
    p_id                 INTEGER,
    p_name               VARCHAR DEFAULT NULL,
    p_kind               VARCHAR DEFAULT NULL,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_clear_parent       BOOLEAN DEFAULT FALSE,
    p_sort_order         INTEGER DEFAULT NULL,
    p_timezone           VARCHAR DEFAULT NULL,
    p_clear_timezone     BOOLEAN DEFAULT FALSE,
    p_address            JSONB   DEFAULT NULL,
    p_location_code      VARCHAR DEFAULT NULL,
    p_clear_code         BOOLEAN DEFAULT FALSE,
    p_geo                JSONB   DEFAULT NULL,
    p_metadata           JSONB   DEFAULT NULL
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
LANGUAGE sql
AS $$
    UPDATE organization.locations SET
        name               = COALESCE(p_name, locations.name),
        kind               = COALESCE(p_kind, locations.kind),
        parent_location_id = CASE
            WHEN p_clear_parent THEN NULL
            WHEN p_parent_location_id IS NOT NULL THEN p_parent_location_id
            ELSE locations.parent_location_id
        END,
        sort_order         = COALESCE(p_sort_order, locations.sort_order),
        timezone           = CASE
            WHEN p_clear_timezone THEN NULL
            WHEN p_timezone IS NOT NULL THEN p_timezone
            ELSE locations.timezone
        END,
        address            = COALESCE(p_address, locations.address),
        location_code      = CASE
            WHEN p_clear_code THEN NULL
            WHEN p_location_code IS NOT NULL THEN p_location_code
            ELSE locations.location_code
        END,
        geo                = COALESCE(p_geo, locations.geo),
        metadata           = COALESCE(p_metadata, locations.metadata),
        updated_at         = NOW()
    WHERE locations.id = p_id
      AND locations.organization_id = p_organization_id
    RETURNING locations.id, locations.organization_id, locations.name, locations.kind,
              locations.parent_location_id, locations.sort_order, locations.timezone,
              locations.address, locations.location_code, locations.geo, locations.metadata,
              locations.created_at, locations.updated_at;
$$;
