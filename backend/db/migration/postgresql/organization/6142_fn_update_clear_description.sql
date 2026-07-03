--------------UP
-- Add a `p_clear_description` flag to persona + user_group update so
-- callers can explicitly null the description (the COALESCE-with-null
-- pattern can only KEEP, never CLEAR). Mirrors the `p_reparent` flag
-- on fn_user_group_update that already distinguishes "leave parent
-- alone" from "set parent to NULL".
--
-- Behavior:
--   p_clear_description = TRUE  → description := NULL
--   p_clear_description = FALSE → description := COALESCE(p_description, description)
DROP FUNCTION organization.fn_persona_update;
CREATE FUNCTION organization.fn_persona_update(
    p_id                UUID,
    p_tenant_id         VARCHAR,
    p_name              VARCHAR,
    p_description       TEXT,
    p_statements        JSONB,
    p_clear_description BOOLEAN DEFAULT FALSE
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
           description = CASE WHEN p_clear_description
                                   THEN NULL
                              ELSE COALESCE(p_description, description) END,
           statements  = COALESCE(p_statements, statements)
     WHERE id = p_id
       AND tenant_id = p_tenant_id
       AND is_system_managed = false
    RETURNING id::text, tenant_id::text, key, name, description,
              is_system_managed, statements, version, created_at, updated_at;
$$;

DROP FUNCTION organization.fn_user_group_update;
CREATE FUNCTION organization.fn_user_group_update(
    p_id                UUID,
    p_tenant_id         VARCHAR,
    p_name              VARCHAR,
    p_description       TEXT,
    p_parent_group_id   UUID,
    p_reparent          BOOLEAN,
    p_clear_description BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id              TEXT,
    tenant_id       TEXT,
    name            VARCHAR,
    description     TEXT,
    parent_group_id TEXT,
    created_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE organization.user_groups
       SET name            = COALESCE(p_name, name),
           description     = CASE WHEN p_clear_description
                                       THEN NULL
                                  ELSE COALESCE(p_description, description) END,
           parent_group_id = CASE WHEN p_reparent
                                    THEN p_parent_group_id
                                    ELSE parent_group_id
                               END
     WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING id::text, tenant_id::text, name, description,
              parent_group_id::text, created_at;
$$;
--------------DOWN
DROP FUNCTION organization.fn_user_group_update;
DROP FUNCTION organization.fn_persona_update;
-- Recreate the pre-flag signatures so DOWN restores callable contracts.
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
CREATE FUNCTION organization.fn_user_group_update(
    p_id              UUID,
    p_tenant_id       VARCHAR,
    p_name            VARCHAR,
    p_description     TEXT,
    p_parent_group_id UUID,
    p_reparent        BOOLEAN
)
RETURNS TABLE (
    id              TEXT,
    tenant_id       TEXT,
    name            VARCHAR,
    description     TEXT,
    parent_group_id TEXT,
    created_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE organization.user_groups
       SET name            = COALESCE(p_name, name),
           description     = COALESCE(p_description, description),
           parent_group_id = CASE WHEN p_reparent
                                    THEN p_parent_group_id
                                    ELSE parent_group_id
                               END
     WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING id::text, tenant_id::text, name, description,
              parent_group_id::text, created_at;
$$;
