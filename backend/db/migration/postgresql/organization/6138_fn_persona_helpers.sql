--------------UP
-- PersonaComponent raw-SQL → fn_*. Tenant-scoped CRUD with the legacy
-- system-managed guard preserved. fn_persona_check_attachable lives in
-- 6136 (shared with AssignmentComponent).

CREATE FUNCTION organization.fn_persona_list(
    p_tenant_id      VARCHAR,
    p_include_system BOOLEAN
)
RETURNS TABLE (
    id                TEXT,
    tenant_id         TEXT,
    key               VARCHAR,
    name              VARCHAR,
    description       TEXT,
    is_system_managed BOOLEAN,
    statements        JSONB,
    version           INT,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, key, name, description,
           is_system_managed, statements, version, created_at, updated_at
      FROM organization.personas
     WHERE (p_include_system AND (tenant_id = p_tenant_id OR tenant_id IS NULL))
        OR (NOT p_include_system AND tenant_id = p_tenant_id)
     ORDER BY is_system_managed DESC, name;
$$;

CREATE FUNCTION organization.fn_persona_get(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (
    id                TEXT,
    tenant_id         TEXT,
    key               VARCHAR,
    name              VARCHAR,
    description       TEXT,
    is_system_managed BOOLEAN,
    statements        JSONB,
    version           INT,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, key, name, description,
           is_system_managed, statements, version, created_at, updated_at
      FROM organization.personas
     WHERE id = p_id AND (tenant_id = p_tenant_id OR tenant_id IS NULL);
$$;

CREATE FUNCTION organization.fn_persona_create(
    p_tenant_id   VARCHAR,
    p_key         VARCHAR,
    p_name        VARCHAR,
    p_description TEXT,
    p_statements  JSONB
)
RETURNS TABLE (
    id                TEXT,
    tenant_id         TEXT,
    key               VARCHAR,
    name              VARCHAR,
    description       TEXT,
    is_system_managed BOOLEAN,
    statements        JSONB,
    version           INT,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO organization.personas
        (tenant_id, key, name, description, is_system_managed, statements)
    VALUES (p_tenant_id, p_key, p_name, p_description, false, p_statements)
    RETURNING id::text, tenant_id::text, key, name, description,
              is_system_managed, statements, version, created_at, updated_at;
$$;

-- Partial-update with COALESCE. NULL params keep the existing column.
-- System-managed personas are excluded so callers don't need a pre-check
-- (an empty result row signals "not editable").
CREATE FUNCTION organization.fn_persona_update(
    p_id          UUID,
    p_tenant_id   VARCHAR,
    p_name        VARCHAR,
    p_description TEXT,
    p_statements  JSONB
)
RETURNS TABLE (
    id                TEXT,
    tenant_id         TEXT,
    key               VARCHAR,
    name              VARCHAR,
    description       TEXT,
    is_system_managed BOOLEAN,
    statements        JSONB,
    version           INT,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE organization.personas
       SET name        = COALESCE(p_name, name),
           description = COALESCE(p_description, description),
           statements  = COALESCE(p_statements, statements)
     WHERE id = p_id
       AND tenant_id = p_tenant_id
       AND is_system_managed = false
    RETURNING id::text, tenant_id::text, key, name, description,
              is_system_managed, statements, version, created_at, updated_at;
$$;

-- Atomic ref-check + delete. Returns (ref_count, deleted_count) so the
-- caller can distinguish "in-use" from "not found / system-managed".
CREATE FUNCTION organization.fn_persona_delete_safe(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (ref_count INT, deleted_count INT)
LANGUAGE sql
AS $$
    WITH refs AS (
        SELECT count(*)::int AS n
          FROM organization.assignments
         WHERE persona_id = p_id AND tenant_id = p_tenant_id
    ),
    deleted AS (
        DELETE FROM organization.personas
         WHERE id = p_id
           AND tenant_id = p_tenant_id
           AND is_system_managed = false
           AND (SELECT n FROM refs) = 0
        RETURNING id
    )
    SELECT (SELECT n FROM refs),
           (SELECT count(*)::int FROM deleted);
$$;

--------------DOWN
DROP FUNCTION organization.fn_persona_delete_safe;
DROP FUNCTION organization.fn_persona_update;
DROP FUNCTION organization.fn_persona_create;
DROP FUNCTION organization.fn_persona_get;
DROP FUNCTION organization.fn_persona_list;
