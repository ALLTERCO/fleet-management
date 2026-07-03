--------------UP
-- Promotes AssignmentComponent's inline SQL to fn_* helpers per Ref P.
-- One file holds the whole component's surface so callers stay grouped.

-- Probe whether a persona is tenant-owned OR system-managed (NULL tenant).
-- Returns 0 rows if not attachable to this tenant.
CREATE FUNCTION organization.fn_persona_check_attachable(
    p_persona_id UUID,
    p_tenant_id  VARCHAR
)
RETURNS TABLE (is_system_managed BOOLEAN)
LANGUAGE sql
STABLE
AS $$
    SELECT p.is_system_managed
      FROM organization.personas p
     WHERE p.id = p_persona_id
       AND (p.tenant_id = p_tenant_id OR p.tenant_id IS NULL);
$$;

-- Boolean existence check for a user_group within a tenant.
CREATE FUNCTION organization.fn_user_group_exists(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM organization.user_groups
         WHERE id = p_id AND tenant_id = p_tenant_id
    );
$$;

-- Insert + return the full assignment row in the AssignmentResponse shape.
CREATE FUNCTION organization.fn_assignment_create(
    p_tenant_id     VARCHAR,
    p_subject_type  VARCHAR,
    p_subject_id    VARCHAR,
    p_persona_id    UUID,
    p_scope         JSONB,
    p_created_by    VARCHAR
)
RETURNS TABLE (
    id           TEXT,
    tenant_id    TEXT,
    subject_type VARCHAR,
    subject_id   TEXT,
    persona_id   TEXT,
    scope        JSONB,
    created_at   TIMESTAMPTZ,
    created_by   TEXT,
    last_used_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO organization.assignments
        (tenant_id, subject_type, subject_id, persona_id, scope, created_by)
    VALUES
        (p_tenant_id, p_subject_type, p_subject_id, p_persona_id, p_scope, p_created_by)
    RETURNING id::text, tenant_id::text, subject_type, subject_id::text,
              persona_id::text, scope, created_at, created_by::text, last_used_at;
$$;

-- Tenant-scoped delete; empty result = not found.
CREATE FUNCTION organization.fn_assignment_delete(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (id TEXT)
LANGUAGE sql
AS $$
    DELETE FROM organization.assignments
     WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING id::text;
$$;

-- Common SELECT projection — kept identical to the legacy inline query.
CREATE FUNCTION organization.fn_assignment_list_for_subject(
    p_tenant_id    VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id   VARCHAR
)
RETURNS TABLE (
    id           TEXT,
    tenant_id    TEXT,
    subject_type VARCHAR,
    subject_id   TEXT,
    persona_id   TEXT,
    scope        JSONB,
    created_at   TIMESTAMPTZ,
    created_by   TEXT,
    last_used_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, subject_type, subject_id::text,
           persona_id::text, scope, created_at, created_by::text, last_used_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND subject_type = p_subject_type
       AND subject_id = p_subject_id
     ORDER BY created_at DESC;
$$;

CREATE FUNCTION organization.fn_assignment_list_for_persona(
    p_tenant_id  VARCHAR,
    p_persona_id UUID
)
RETURNS TABLE (
    id           TEXT,
    tenant_id    TEXT,
    subject_type VARCHAR,
    subject_id   TEXT,
    persona_id   TEXT,
    scope        JSONB,
    created_at   TIMESTAMPTZ,
    created_by   TEXT,
    last_used_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, subject_type, subject_id::text,
           persona_id::text, scope, created_at, created_by::text, last_used_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id AND persona_id = p_persona_id
     ORDER BY created_at DESC;
$$;

-- Scope-probe match: any assignment whose scope contains the probe OR
-- the wildcard {"all":true}.
CREATE FUNCTION organization.fn_assignment_list_for_resource(
    p_tenant_id   VARCHAR,
    p_scope_probe JSONB
)
RETURNS TABLE (
    id           TEXT,
    tenant_id    TEXT,
    subject_type VARCHAR,
    subject_id   TEXT,
    persona_id   TEXT,
    scope        JSONB,
    created_at   TIMESTAMPTZ,
    created_by   TEXT,
    last_used_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, subject_type, subject_id::text,
           persona_id::text, scope, created_at, created_by::text, last_used_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND (scope @> p_scope_probe OR scope @> '{"all":true}'::jsonb)
     ORDER BY created_at DESC;
$$;

CREATE FUNCTION organization.fn_assignment_list_unused(
    p_tenant_id      VARCHAR,
    p_threshold_days INT
)
RETURNS TABLE (
    id           TEXT,
    tenant_id    TEXT,
    subject_type VARCHAR,
    subject_id   TEXT,
    persona_id   TEXT,
    scope        JSONB,
    created_at   TIMESTAMPTZ,
    created_by   TEXT,
    last_used_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, subject_type, subject_id::text,
           persona_id::text, scope, created_at, created_by::text, last_used_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND (last_used_at IS NULL
            OR last_used_at < now() - make_interval(days => p_threshold_days))
     ORDER BY last_used_at NULLS FIRST, created_at;
$$;

--------------DOWN
DROP FUNCTION organization.fn_assignment_list_unused;
DROP FUNCTION organization.fn_assignment_list_for_resource;
DROP FUNCTION organization.fn_assignment_list_for_persona;
DROP FUNCTION organization.fn_assignment_list_for_subject;
DROP FUNCTION organization.fn_assignment_delete;
DROP FUNCTION organization.fn_assignment_create;
DROP FUNCTION organization.fn_user_group_exists;
DROP FUNCTION organization.fn_persona_check_attachable;
