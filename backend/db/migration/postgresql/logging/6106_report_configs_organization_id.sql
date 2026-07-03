--------------UP
-- report_configs has no tenant column; AddReportConfig and DeleteReportConfig
-- mutate the global set. Tenant admin can create/delete configs that other
-- tenants see in ListReportConfigs. Add organization_id and route every
-- helper through it.

ALTER TABLE logging.report_configs
    ADD COLUMN IF NOT EXISTS organization_id VARCHAR(120) NULL;

CREATE INDEX IF NOT EXISTS logging__report_configs_org_idx
    ON logging.report_configs (organization_id);

DROP FUNCTION IF EXISTS logging.add_report_config(VARCHAR, JSONB);
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

DROP FUNCTION IF EXISTS logging.delete_report_config(INT);
CREATE OR REPLACE FUNCTION logging.delete_report_config(
    p_id              INT,
    p_organization_id VARCHAR DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
AS $$
    DELETE FROM logging.report_configs
     WHERE id = p_id
       AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    RETURNING id;
$$;

DROP FUNCTION IF EXISTS logging.get_report_configs();
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

--------------DOWN
DROP FUNCTION IF EXISTS logging.get_report_configs(VARCHAR);
CREATE OR REPLACE FUNCTION logging.get_report_configs()
RETURNS TABLE (
    id          INT,
    report_type VARCHAR(128),
    params      JSONB
)
LANGUAGE sql
AS $$
    SELECT rc.id, rc.report_type, rc.params
      FROM logging.report_configs rc
     ORDER BY rc.created DESC;
$$;

DROP FUNCTION IF EXISTS logging.delete_report_config(INT, VARCHAR);
CREATE OR REPLACE FUNCTION logging.delete_report_config(p_id INT)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM logging.report_configs WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS logging.add_report_config(VARCHAR, JSONB, VARCHAR);
CREATE OR REPLACE FUNCTION logging.add_report_config(
    p_report_type VARCHAR,
    p_params      JSONB
)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO logging.report_configs (report_type, params, updated)
    VALUES (p_report_type, COALESCE(p_params, '{}'::jsonb), CURRENT_TIMESTAMP)
    RETURNING id;
$$;

DROP INDEX IF EXISTS logging.logging__report_configs_org_idx;
ALTER TABLE logging.report_configs DROP COLUMN IF EXISTS organization_id;
