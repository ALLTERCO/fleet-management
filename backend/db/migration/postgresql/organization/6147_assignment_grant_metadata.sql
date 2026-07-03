--------------UP
ALTER TABLE organization.assignments
    ADD COLUMN IF NOT EXISTS reason text,
    ADD COLUMN IF NOT EXISTS comment text,
    ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS assignments_expires_at_idx
    ON organization.assignments (tenant_id, expires_at)
    WHERE expires_at IS NOT NULL;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE shape.
DROP FUNCTION IF EXISTS organization.fn_assignment_create(
    VARCHAR, VARCHAR, VARCHAR, UUID, JSONB, VARCHAR
);
CREATE FUNCTION organization.fn_assignment_create(
    p_tenant_id  VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR,
    p_persona_id UUID,
    p_scope JSONB,
    p_created_by VARCHAR,
    p_reason TEXT,
    p_comment TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ,
    reason TEXT,
    comment TEXT,
    expires_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO organization.assignments
        (
            tenant_id,
            subject_type,
            subject_id,
            persona_id,
            scope,
            created_by,
            reason,
            comment,
            expires_at
        )
    VALUES
        (
            p_tenant_id,
            p_subject_type,
            p_subject_id,
            p_persona_id,
            p_scope,
            p_created_by,
            p_reason,
            p_comment,
            p_expires_at
        )
    RETURNING id::text,
              tenant_id::text,
              subject_type,
              subject_id::text,
              persona_id::text,
              scope,
              created_at,
              created_by::text,
              last_used_at,
              reason,
              comment,
              expires_at;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE shape.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_subject(
    VARCHAR, VARCHAR, VARCHAR
);
CREATE FUNCTION organization.fn_assignment_list_for_subject(
    p_tenant_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ,
    reason TEXT,
    comment TEXT,
    expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text,
           tenant_id::text,
           subject_type,
           subject_id::text,
           persona_id::text,
           scope,
           created_at,
           created_by::text,
           last_used_at,
           reason,
           comment,
           expires_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND subject_type = p_subject_type
       AND subject_id = p_subject_id
     ORDER BY created_at DESC;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE shape.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_persona(
    VARCHAR, UUID
);
CREATE FUNCTION organization.fn_assignment_list_for_persona(
    p_tenant_id VARCHAR,
    p_persona_id UUID
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ,
    reason TEXT,
    comment TEXT,
    expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text,
           tenant_id::text,
           subject_type,
           subject_id::text,
           persona_id::text,
           scope,
           created_at,
           created_by::text,
           last_used_at,
           reason,
           comment,
           expires_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND persona_id = p_persona_id
     ORDER BY created_at DESC;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE shape.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_resource(
    VARCHAR, JSONB
);
CREATE FUNCTION organization.fn_assignment_list_for_resource(
    p_tenant_id VARCHAR,
    p_scope_probe JSONB
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ,
    reason TEXT,
    comment TEXT,
    expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text,
           tenant_id::text,
           subject_type,
           subject_id::text,
           persona_id::text,
           scope,
           created_at,
           created_by::text,
           last_used_at,
           reason,
           comment,
           expires_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND (expires_at IS NULL OR expires_at > now())
       AND (scope @> p_scope_probe OR scope @> '{"all":true}'::jsonb)
     ORDER BY created_at DESC;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE shape.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_unused(
    VARCHAR, INT
);
CREATE FUNCTION organization.fn_assignment_list_unused(
    p_tenant_id VARCHAR,
    p_threshold_days INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ,
    reason TEXT,
    comment TEXT,
    expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text,
           tenant_id::text,
           subject_type,
           subject_id::text,
           persona_id::text,
           scope,
           created_at,
           created_by::text,
           last_used_at,
           reason,
           comment,
           expires_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND (expires_at IS NULL OR expires_at > now())
       AND (
           last_used_at IS NULL
           OR last_used_at < now() - make_interval(days => p_threshold_days)
       )
     ORDER BY last_used_at NULLS FIRST, created_at;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_assignment_list_unused(VARCHAR, INT);
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_resource(VARCHAR, JSONB);
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_persona(VARCHAR, UUID);
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_subject(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_assignment_create(
    VARCHAR, VARCHAR, VARCHAR, UUID, JSONB, VARCHAR, TEXT, TEXT, TIMESTAMPTZ
);

CREATE FUNCTION organization.fn_assignment_create(
    p_tenant_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR,
    p_persona_id UUID,
    p_scope JSONB,
    p_created_by VARCHAR
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
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

CREATE FUNCTION organization.fn_assignment_list_for_subject(
    p_tenant_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
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
    p_tenant_id VARCHAR,
    p_persona_id UUID
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, subject_type, subject_id::text,
           persona_id::text, scope, created_at, created_by::text, last_used_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND persona_id = p_persona_id
     ORDER BY created_at DESC;
$$;

CREATE FUNCTION organization.fn_assignment_list_for_resource(
    p_tenant_id VARCHAR,
    p_scope_probe JSONB
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
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
    p_tenant_id VARCHAR,
    p_threshold_days INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    subject_type VARCHAR,
    subject_id TEXT,
    persona_id TEXT,
    scope JSONB,
    created_at TIMESTAMPTZ,
    created_by TEXT,
    last_used_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, subject_type, subject_id::text,
           persona_id::text, scope, created_at, created_by::text, last_used_at
      FROM organization.assignments
     WHERE tenant_id = p_tenant_id
       AND (
           last_used_at IS NULL
           OR last_used_at < now() - make_interval(days => p_threshold_days)
       )
     ORDER BY last_used_at NULLS FIRST, created_at;
$$;

DROP INDEX IF EXISTS organization.assignments_expires_at_idx;
ALTER TABLE organization.assignments
    DROP COLUMN IF EXISTS expires_at,
    DROP COLUMN IF EXISTS comment,
    DROP COLUMN IF EXISTS reason;
