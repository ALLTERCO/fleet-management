--------------UP
-- Lists templates available to an org: org-scoped + (optionally) builtins,
-- with org overrides shadowing builtin keys.
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_list(
    VARCHAR, VARCHAR, BOOLEAN
);
CREATE FUNCTION ui.fn_dashboard_template_list(
    p_organization_id VARCHAR,
    p_dashboard_type  VARCHAR DEFAULT NULL,
    p_include_builtin BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    key             VARCHAR,
    label           VARCHAR,
    description     TEXT,
    dashboard_type  VARCHAR,
    organization_id VARCHAR,
    is_builtin      BOOLEAN,
    seed            JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH ranked AS (
        SELECT t.*,
               ROW_NUMBER() OVER (
                   PARTITION BY t.key
                   ORDER BY (t.organization_id IS NULL) ASC
               ) AS rn
        FROM ui.dashboard_template t
        WHERE (t.organization_id = p_organization_id
               OR (p_include_builtin AND t.organization_id IS NULL))
          AND (p_dashboard_type IS NULL OR t.dashboard_type = p_dashboard_type)
    )
    SELECT key, label, description, dashboard_type, organization_id,
           is_builtin, seed, created_at, updated_at
      FROM ranked
     WHERE rn = 1
     ORDER BY dashboard_type, key;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_list(
    VARCHAR, VARCHAR, BOOLEAN
);
