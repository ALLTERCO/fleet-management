--------------UP
-- Persona templates: bundle FleetRole + location-scope mode + per-component
-- defaults. Per-org. Resolved at user assignment time.

CREATE TABLE organization.persona_templates (
    id              SERIAL  PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name            VARCHAR(120) NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    fleet_role      VARCHAR(32)  NOT NULL,
    location_scope_mode VARCHAR(16) NOT NULL,
    component_defaults  JSONB     NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    created_by      VARCHAR(120),
    CONSTRAINT persona_template_name_per_org UNIQUE (organization_id, name),
    CONSTRAINT persona_template_role_check CHECK (
        fleet_role IN ('None','Viewer','Operator','Installer','Admin','Custom')
    ),
    CONSTRAINT persona_template_scope_mode_check CHECK (
        location_scope_mode IN ('ALL','SELECTED','PARAMETERIZED')
    )
);

CREATE INDEX IF NOT EXISTS persona_templates_by_org
    ON organization.persona_templates (organization_id);

-- List all templates for an org. Ordered by name for stable UI lists.
CREATE OR REPLACE FUNCTION organization.fn_persona_template_list(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, description TEXT,
    fleet_role VARCHAR, location_scope_mode VARCHAR,
    component_defaults JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, created_by VARCHAR
)
LANGUAGE sql
AS $$
    SELECT t.id, t.organization_id, t.name, t.description,
           t.fleet_role, t.location_scope_mode, t.component_defaults,
           t.created_at, t.updated_at, t.created_by
    FROM organization.persona_templates t
    WHERE t.organization_id = p_organization_id
    ORDER BY t.name;
$$;

CREATE OR REPLACE FUNCTION organization.fn_persona_template_get(
    p_organization_id VARCHAR,
    p_id INTEGER
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, description TEXT,
    fleet_role VARCHAR, location_scope_mode VARCHAR,
    component_defaults JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, created_by VARCHAR
)
LANGUAGE sql
AS $$
    SELECT t.id, t.organization_id, t.name, t.description,
           t.fleet_role, t.location_scope_mode, t.component_defaults,
           t.created_at, t.updated_at, t.created_by
    FROM organization.persona_templates t
    WHERE t.organization_id = p_organization_id AND t.id = p_id;
$$;

CREATE OR REPLACE FUNCTION organization.fn_persona_template_create(
    p_organization_id     VARCHAR,
    p_name                VARCHAR,
    p_description         TEXT,
    p_fleet_role          VARCHAR,
    p_location_scope_mode VARCHAR,
    p_component_defaults  JSONB,
    p_created_by          VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    INSERT INTO organization.persona_templates (
        organization_id, name, description, fleet_role,
        location_scope_mode, component_defaults, created_by
    ) VALUES (
        p_organization_id, p_name, COALESCE(p_description, ''),
        p_fleet_role, p_location_scope_mode,
        COALESCE(p_component_defaults, '{}'::jsonb), p_created_by
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_persona_template_update(
    p_organization_id     VARCHAR,
    p_id                  INTEGER,
    p_name                VARCHAR,
    p_description         TEXT,
    p_fleet_role          VARCHAR,
    p_location_scope_mode VARCHAR,
    p_component_defaults  JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE organization.persona_templates
    SET name = COALESCE(p_name, name),
        description = COALESCE(p_description, description),
        fleet_role = COALESCE(p_fleet_role, fleet_role),
        location_scope_mode = COALESCE(p_location_scope_mode, location_scope_mode),
        component_defaults = COALESCE(p_component_defaults, component_defaults),
        updated_at = NOW()
    WHERE organization_id = p_organization_id AND id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_persona_template_delete(
    p_organization_id VARCHAR,
    p_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM organization.persona_templates
    WHERE organization_id = p_organization_id AND id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_persona_template_delete(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS organization.fn_persona_template_update(VARCHAR, INTEGER, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS organization.fn_persona_template_create(VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB, VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_persona_template_get(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS organization.fn_persona_template_list(VARCHAR);
DROP TABLE IF EXISTS organization.persona_templates;
