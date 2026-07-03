--------------UP
-- Scope allowlist pushed to SQL — matches fn_location_list v2 pattern.
DROP FUNCTION IF EXISTS organization.fn_location_list_assignments(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION organization.fn_location_list_assignments(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR   DEFAULT NULL,
    p_subject_id      VARCHAR   DEFAULT NULL,
    p_location_id     INTEGER   DEFAULT NULL,
    p_limit           INTEGER   DEFAULT 200,
    p_offset          INTEGER   DEFAULT 0,
    p_allowed_ids     INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count     BIGINT,
    organization_id VARCHAR,
    subject_type    VARCHAR,
    subject_id      VARCHAR,
    location_id     INTEGER,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM organization.location_assignments
        WHERE organization_id = p_organization_id
          AND (p_subject_type IS NULL OR subject_type = p_subject_type)
          AND (p_subject_id IS NULL OR subject_id = p_subject_id)
          AND (p_location_id IS NULL OR location_id = p_location_id)
          AND (p_allowed_ids IS NULL OR location_id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.organization_id, f.subject_type, f.subject_id,
        f.location_id, f.created_at, f.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY subject_type ASC, subject_id ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_list_assignments(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_location_list_assignments(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_subject_id      VARCHAR DEFAULT NULL,
    p_location_id     INTEGER DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count     BIGINT,
    organization_id VARCHAR,
    subject_type    VARCHAR,
    subject_id      VARCHAR,
    location_id     INTEGER,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM organization.location_assignments
        WHERE organization_id = p_organization_id
          AND (p_subject_type IS NULL OR subject_type = p_subject_type)
          AND (p_subject_id IS NULL OR subject_id = p_subject_id)
          AND (p_location_id IS NULL OR location_id = p_location_id)
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.organization_id, f.subject_type, f.subject_id,
        f.location_id, f.created_at, f.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY subject_type ASC, subject_id ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
