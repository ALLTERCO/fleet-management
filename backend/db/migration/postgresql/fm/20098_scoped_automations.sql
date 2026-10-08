--------------UP
CREATE TABLE IF NOT EXISTS fm.scoped_automation (
    id UUID PRIMARY KEY,
    tenant_id VARCHAR(120) NOT NULL,
    owner_user_id VARCHAR(200) NOT NULL,
    owner_credential_id VARCHAR(200),
    name VARCHAR(120) NOT NULL,
    device_ids TEXT[] NOT NULL,
    schedule_json JSONB NOT NULL,
    method VARCHAR(128) NOT NULL,
    params_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    token_hash CHAR(64) NOT NULL,
    authority_json JSONB NOT NULL,
    deployment_state VARCHAR(16) NOT NULL DEFAULT 'draft',
    execution_state VARCHAR(16) NOT NULL DEFAULT 'idle',
    flow_id VARCHAR(100),
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT scoped_automation_devices_chk
        CHECK (cardinality(device_ids) BETWEEN 1 AND 100),
    CONSTRAINT scoped_automation_deployment_state_chk
        CHECK (deployment_state IN ('draft', 'active', 'revoked')),
    CONSTRAINT scoped_automation_execution_state_chk
        CHECK (execution_state IN ('idle', 'unknown')),
    CONSTRAINT scoped_automation_schedule_chk CHECK (
        schedule_json->>'kind' IN ('timer', 'cron')
    )
);

CREATE INDEX IF NOT EXISTS scoped_automation_owner_idx
    ON fm.scoped_automation (
        tenant_id, owner_user_id, owner_credential_id, created_at DESC
    );

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_rows(
    p_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name VARCHAR(120),
    device_ids TEXT[],
    schedule_json JSONB,
    method VARCHAR(128),
    params_json JSONB,
    deployment_state VARCHAR(16),
    execution_state VARCHAR(16),
    revision BIGINT,
    flow_id VARCHAR(100),
    authority_json JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT a.id, a.name, a.device_ids, a.schedule_json, a.method,
           a.params_json, a.deployment_state, a.execution_state, a.revision,
           a.flow_id, a.authority_json, a.created_at, a.updated_at
      FROM fm.scoped_automation a
     WHERE p_id IS NULL OR a.id = p_id;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_create_draft(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_owner_user_id VARCHAR(200),
    p_owner_credential_id VARCHAR(200),
    p_name VARCHAR(120),
    p_device_ids TEXT[],
    p_schedule JSONB,
    p_method VARCHAR(128),
    p_params JSONB,
    p_token_hash CHAR(64),
    p_authority JSONB
)
RETURNS SETOF fm.scoped_automation
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO fm.scoped_automation (
        id, tenant_id, owner_user_id, owner_credential_id, name, device_ids,
        schedule_json, method, params_json, token_hash, authority_json
    ) VALUES (
        p_id, p_tenant_id, p_owner_user_id, p_owner_credential_id, p_name,
        p_device_ids, p_schedule, p_method, p_params, p_token_hash, p_authority
    )
    ON CONFLICT (id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash,
           authority_json = EXCLUDED.authority_json,
           revision = fm.scoped_automation.revision + 1,
           updated_at = now()
     WHERE fm.scoped_automation.tenant_id = EXCLUDED.tenant_id
       AND fm.scoped_automation.owner_user_id = EXCLUDED.owner_user_id
       AND fm.scoped_automation.owner_credential_id IS NOT DISTINCT FROM
           EXCLUDED.owner_credential_id
       AND fm.scoped_automation.deployment_state = 'draft'
       AND fm.scoped_automation.name = EXCLUDED.name
       AND fm.scoped_automation.device_ids = EXCLUDED.device_ids
       AND fm.scoped_automation.schedule_json = EXCLUDED.schedule_json
       AND fm.scoped_automation.method = EXCLUDED.method
       AND fm.scoped_automation.params_json = EXCLUDED.params_json;
    RETURN QUERY SELECT * FROM fm.scoped_automation a
     WHERE a.id = p_id
       AND a.tenant_id = p_tenant_id
       AND a.owner_user_id = p_owner_user_id
       AND a.owner_credential_id IS NOT DISTINCT FROM p_owner_credential_id
       AND a.deployment_state = 'draft'
       AND a.name = p_name AND a.device_ids = p_device_ids
       AND a.schedule_json = p_schedule AND a.method = p_method
       AND a.params_json = p_params;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_list(
    p_tenant_id VARCHAR(120),
    p_owner_user_id VARCHAR(200),
    p_owner_credential_id VARCHAR(200),
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id UUID, name VARCHAR(120), device_ids TEXT[], schedule_json JSONB,
    method VARCHAR(128), params_json JSONB, deployment_state VARCHAR(16),
    execution_state VARCHAR(16), revision BIGINT, flow_id VARCHAR(100),
    authority_json JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT a.id, a.name, a.device_ids, a.schedule_json, a.method,
           a.params_json, a.deployment_state, a.execution_state, a.revision,
           a.flow_id, a.authority_json, a.created_at, a.updated_at,
           count(*) OVER()
      FROM fm.scoped_automation a
     WHERE a.tenant_id = p_tenant_id
       AND a.owner_user_id = p_owner_user_id
       AND a.owner_credential_id IS NOT DISTINCT FROM p_owner_credential_id
     ORDER BY a.created_at DESC, a.id
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
    OFFSET GREATEST(p_offset, 0);
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_get(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_owner_user_id VARCHAR(200),
    p_owner_credential_id VARCHAR(200)
)
RETURNS SETOF fm.scoped_automation
LANGUAGE sql
STABLE
AS $$
    SELECT * FROM fm.scoped_automation a
     WHERE a.id = p_id AND a.tenant_id = p_tenant_id
       AND a.owner_user_id = p_owner_user_id
       AND a.owner_credential_id IS NOT DISTINCT FROM p_owner_credential_id;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_disable(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_owner_user_id VARCHAR(200),
    p_owner_credential_id VARCHAR(200),
    p_expected_revision BIGINT,
    p_definition JSONB,
    p_token_hash CHAR(64),
    p_authority JSONB
)
RETURNS SETOF fm.scoped_automation
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE fm.scoped_automation a
       SET deployment_state = 'draft',
           name = COALESCE(p_definition->>'name', a.name),
           device_ids = CASE WHEN p_definition IS NULL THEN a.device_ids ELSE
               ARRAY(SELECT jsonb_array_elements_text(p_definition->'deviceIds')) END,
           schedule_json = COALESCE(p_definition->'schedule', a.schedule_json),
           method = COALESCE(p_definition->>'method', a.method),
           params_json = COALESCE(p_definition->'params', a.params_json),
           token_hash = COALESCE(p_token_hash, a.token_hash),
           authority_json = COALESCE(p_authority, a.authority_json),
           revision = a.revision + 1,
           updated_at = now()
     WHERE a.id = p_id AND a.tenant_id = p_tenant_id
       AND a.owner_user_id = p_owner_user_id
       AND a.owner_credential_id IS NOT DISTINCT FROM p_owner_credential_id
       AND a.revision = p_expected_revision
       AND a.execution_state = 'idle'
    RETURNING a.*;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_activate(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_owner_user_id VARCHAR(200),
    p_owner_credential_id VARCHAR(200),
    p_expected_revision BIGINT,
    p_flow_id VARCHAR(100)
)
RETURNS SETOF fm.scoped_automation
LANGUAGE sql
AS $$
    UPDATE fm.scoped_automation a
       SET deployment_state = 'active', flow_id = p_flow_id,
           revision = a.revision + 1, updated_at = now()
     WHERE a.id = p_id AND a.tenant_id = p_tenant_id
       AND a.owner_user_id = p_owner_user_id
       AND a.owner_credential_id IS NOT DISTINCT FROM p_owner_credential_id
       AND a.revision = p_expected_revision
       AND a.deployment_state = 'draft'
    RETURNING a.*;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_delete(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_owner_user_id VARCHAR(200),
    p_owner_credential_id VARCHAR(200),
    p_expected_revision BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_deleted BIGINT;
BEGIN
    DELETE FROM fm.scoped_automation a
     WHERE a.id = p_id AND a.tenant_id = p_tenant_id
       AND a.owner_user_id = p_owner_user_id
       AND a.owner_credential_id IS NOT DISTINCT FROM p_owner_credential_id
       AND a.revision = p_expected_revision
       AND a.deployment_state = 'draft'
       AND a.execution_state = 'idle';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_begin_run(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_token_hash CHAR(64)
)
RETURNS SETOF fm.scoped_automation
LANGUAGE sql
AS $$
    UPDATE fm.scoped_automation a
       SET execution_state = 'unknown', updated_at = now()
     WHERE a.id = p_id AND a.tenant_id = p_tenant_id
       AND a.token_hash = p_token_hash
       AND a.deployment_state = 'active' AND a.execution_state = 'idle'
    RETURNING a.*;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_finish_run(
    p_id UUID,
    p_token_hash CHAR(64)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_changed BIGINT;
BEGIN
    UPDATE fm.scoped_automation a
       SET execution_state = 'idle', updated_at = now()
     WHERE a.id = p_id AND a.token_hash = p_token_hash
       AND a.execution_state = 'unknown';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed > 0;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_finish_run(UUID, CHAR(64));
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_begin_run(
    UUID, VARCHAR(120), CHAR(64)
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_delete(
    UUID, VARCHAR(120), VARCHAR(200), VARCHAR(200), BIGINT
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_activate(
    UUID, VARCHAR(120), VARCHAR(200), VARCHAR(200), BIGINT, VARCHAR(100)
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_disable(
    UUID, VARCHAR(120), VARCHAR(200), VARCHAR(200), BIGINT, JSONB, CHAR(64), JSONB
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_get(
    UUID, VARCHAR(120), VARCHAR(200), VARCHAR(200)
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_list(
    VARCHAR(120), VARCHAR(200), VARCHAR(200), INT, INT
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_create_draft(
    UUID, VARCHAR(120), VARCHAR(200), VARCHAR(200), VARCHAR(120), TEXT[], JSONB,
    VARCHAR(128), JSONB, CHAR(64), JSONB
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_rows(UUID);
DROP TABLE IF EXISTS fm.scoped_automation;
