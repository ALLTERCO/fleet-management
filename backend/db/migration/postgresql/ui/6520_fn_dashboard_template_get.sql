--------------UP
-- Org-override → builtin lookup. Returns single row or no row.
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_get(VARCHAR, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_template_get(
    p_key             VARCHAR,
    p_organization_id VARCHAR
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
    SELECT key, label, description, dashboard_type, organization_id,
           is_builtin, seed, created_at, updated_at
      FROM ui.dashboard_template
     WHERE key = p_key
       AND (organization_id = p_organization_id OR organization_id IS NULL)
     ORDER BY (organization_id IS NULL) ASC
     LIMIT 1;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_get(VARCHAR, VARCHAR);
