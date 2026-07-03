--------------UP
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_create(
    VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB, VARCHAR, BOOLEAN
);
CREATE FUNCTION ui.fn_dashboard_template_create(
    p_key             VARCHAR,
    p_label           VARCHAR,
    p_description     TEXT,
    p_dashboard_type  VARCHAR,
    p_seed            JSONB,
    p_organization_id VARCHAR,
    p_is_builtin      BOOLEAN DEFAULT FALSE
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
    INSERT INTO ui.dashboard_template
        (organization_id, key, label, description, dashboard_type, seed,
         is_builtin)
    VALUES
        (p_organization_id, p_key, p_label, p_description, p_dashboard_type,
         p_seed, p_is_builtin)
    RETURNING key, label, description, dashboard_type, organization_id,
              is_builtin, seed, created_at, updated_at;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_template_update(
    VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB
);
CREATE FUNCTION ui.fn_dashboard_template_update(
    p_key             VARCHAR,
    p_organization_id VARCHAR,
    p_label           VARCHAR DEFAULT NULL,
    p_description     TEXT DEFAULT NULL,
    p_seed            JSONB DEFAULT NULL
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
    UPDATE ui.dashboard_template t SET
        label       = COALESCE(p_label,       t.label),
        description = COALESCE(p_description, t.description),
        seed        = COALESCE(p_seed,        t.seed),
        updated_at  = NOW()
      WHERE t.key = p_key
        AND ((p_organization_id IS NULL AND t.organization_id IS NULL)
             OR t.organization_id = p_organization_id)
    RETURNING t.key, t.label, t.description, t.dashboard_type,
              t.organization_id, t.is_builtin, t.seed, t.created_at,
              t.updated_at;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_template_delete(VARCHAR, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_template_delete(
    p_key             VARCHAR,
    p_organization_id VARCHAR
)
RETURNS TABLE (deleted VARCHAR)
LANGUAGE sql
AS $$
    DELETE FROM ui.dashboard_template
     WHERE key = p_key
       AND ((p_organization_id IS NULL AND organization_id IS NULL)
            OR organization_id = p_organization_id)
       AND is_builtin = FALSE
    RETURNING key AS deleted;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_create(
    VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB, VARCHAR, BOOLEAN
);
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_update(
    VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB
);
DROP FUNCTION IF EXISTS ui.fn_dashboard_template_delete(VARCHAR, VARCHAR);
