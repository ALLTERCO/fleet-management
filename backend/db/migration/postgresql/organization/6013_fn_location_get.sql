--------------UP
CREATE OR REPLACE FUNCTION organization.fn_location_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
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
    SELECT id, organization_id, name, kind, parent_location_id, sort_order,
           timezone, address, location_code, geo, metadata, created_at, updated_at
    FROM organization.locations
    WHERE id = p_id AND organization_id = p_organization_id;
$$;
--------------DOWN
DROP FUNCTION organization.fn_location_get;
