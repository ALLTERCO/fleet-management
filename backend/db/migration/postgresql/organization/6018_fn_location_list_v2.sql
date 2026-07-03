--------------UP
-- Explicit `p_roots_only` replaces the -1 sentinel. Allowed-ids allowlist
-- pushes scope filtering to SQL. Total is always returned.
DROP FUNCTION IF EXISTS organization.fn_location_list(VARCHAR, INTEGER, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id VARCHAR,
    p_parent_id       INTEGER DEFAULT NULL,
    p_roots_only      BOOLEAN DEFAULT FALSE,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_allowed_ids     INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count         BIGINT,
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
    WITH filtered AS (
        SELECT l.*
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND (
              p_roots_only IS FALSE AND p_parent_id IS NULL
              OR (p_roots_only IS TRUE AND l.parent_location_id IS NULL)
              OR (p_roots_only IS FALSE AND l.parent_location_id = p_parent_id)
          )
          AND (p_allowed_ids IS NULL OR l.id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.name, f.kind, f.parent_location_id,
        f.sort_order, f.timezone, f.address, f.location_code, f.geo,
        f.metadata, f.created_at, f.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY sort_order ASC, name ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_list(VARCHAR, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id VARCHAR,
    p_parent_id       INTEGER DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
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
    updated_at          TIMESTAMPTZ,
    total_count         BIGINT
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM organization.locations
        WHERE organization_id = p_organization_id
          AND (
              p_parent_id IS NULL
              OR (p_parent_id = -1 AND parent_location_id IS NULL)
              OR parent_location_id = p_parent_id
          )
    )
    SELECT id, organization_id, name, kind, parent_location_id, sort_order,
           timezone, address, location_code, geo, metadata, created_at, updated_at,
           (SELECT COUNT(*) FROM filtered) AS total_count
    FROM filtered
    ORDER BY sort_order ASC, name ASC
    LIMIT p_limit OFFSET p_offset;
$$;
