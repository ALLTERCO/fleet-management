--------------UP
-- Report configs get a human name so access scopes and admin UIs can show
-- something better than "report_type #id".

ALTER TABLE logging.report_configs
    ADD COLUMN IF NOT EXISTS name VARCHAR(120) NULL;

DROP FUNCTION IF EXISTS logging.get_report_configs(VARCHAR);
CREATE OR REPLACE FUNCTION logging.get_report_configs(
    p_organization_id VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id              INT,
    report_type     VARCHAR(128),
    params          JSONB,
    organization_id VARCHAR(120),
    name            VARCHAR(120)
)
LANGUAGE sql
AS $$
    SELECT rc.id, rc.report_type, rc.params, rc.organization_id, rc.name
      FROM logging.report_configs rc
     WHERE p_organization_id IS NULL OR rc.organization_id = p_organization_id
     ORDER BY rc.created DESC;
$$;

DROP FUNCTION IF EXISTS logging.get_report_config(INT);
CREATE OR REPLACE FUNCTION logging.get_report_config(
    p_id INT
)
RETURNS TABLE (
    id          INT,
    report_type VARCHAR(128),
    params      JSONB,
    name        VARCHAR(120)
)
LANGUAGE sql
AS $$
    SELECT rc.id, rc.report_type, rc.params, rc.name
      FROM logging.report_configs rc
     WHERE rc.id = p_id;
$$;

DROP FUNCTION IF EXISTS logging.add_report_config(VARCHAR, JSONB, VARCHAR);
CREATE OR REPLACE FUNCTION logging.add_report_config(
    p_report_type     VARCHAR,
    p_params          JSONB,
    p_organization_id VARCHAR DEFAULT NULL,
    p_name            VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.report_configs (
        report_type, params, organization_id, name, updated
    )
    VALUES (
        p_report_type, COALESCE(p_params, '{}'::jsonb), p_organization_id,
        p_name, CURRENT_TIMESTAMP
    )
    RETURNING id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS logging.add_report_config(VARCHAR, JSONB, VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION logging.add_report_config(
    p_report_type     VARCHAR,
    p_params          JSONB,
    p_organization_id VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.report_configs (
        report_type, params, organization_id, updated
    )
    VALUES (
        p_report_type, COALESCE(p_params, '{}'::jsonb), p_organization_id,
        CURRENT_TIMESTAMP
    )
    RETURNING id;
$$;

DROP FUNCTION IF EXISTS logging.get_report_config(INT);
CREATE OR REPLACE FUNCTION logging.get_report_config(
    p_id INT
)
RETURNS TABLE (
    id          INT,
    report_type VARCHAR(128),
    params      JSONB
)
LANGUAGE sql
AS $$
    SELECT rc.id, rc.report_type, rc.params
      FROM logging.report_configs rc
     WHERE rc.id = p_id;
$$;

DROP FUNCTION IF EXISTS logging.get_report_configs(VARCHAR);
CREATE OR REPLACE FUNCTION logging.get_report_configs(
    p_organization_id VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id              INT,
    report_type     VARCHAR(128),
    params          JSONB,
    organization_id VARCHAR(120)
)
LANGUAGE sql
AS $$
    SELECT rc.id, rc.report_type, rc.params, rc.organization_id
      FROM logging.report_configs rc
     WHERE p_organization_id IS NULL OR rc.organization_id = p_organization_id
     ORDER BY rc.created DESC;
$$;

ALTER TABLE logging.report_configs DROP COLUMN IF EXISTS name;
