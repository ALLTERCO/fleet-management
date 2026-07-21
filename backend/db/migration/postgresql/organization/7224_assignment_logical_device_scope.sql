--------------UP
CREATE UNIQUE INDEX IF NOT EXISTS assignments_tenant_id_id_unique
    ON organization.assignments (tenant_id, id);

CREATE TABLE IF NOT EXISTS organization.assignment_device_scope (
    assignment_id UUID NOT NULL,
    tenant_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL,
    PRIMARY KEY (assignment_id, device_id),
    CONSTRAINT assignment_device_scope_assignment_fk
        FOREIGN KEY (tenant_id, assignment_id)
        REFERENCES organization.assignments (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT assignment_device_scope_device_fk
        FOREIGN KEY (tenant_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM organization.assignments a
          CROSS JOIN LATERAL jsonb_array_elements_text(
              a.scope->'device_ids'
          ) scoped(external_id)
          LEFT JOIN device.list dl
            ON dl.organization_id = a.tenant_id
           AND dl.external_id = scoped.external_id
         WHERE a.scope ? 'device_ids'
           AND dl.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot migrate unresolved assignment device scope';
    END IF;
END;
$$;

INSERT INTO organization.assignment_device_scope (
    assignment_id, tenant_id, device_id
)
SELECT DISTINCT a.id, a.tenant_id, dl.id
  FROM organization.assignments a
  CROSS JOIN LATERAL jsonb_array_elements_text(
      a.scope->'device_ids'
  ) scoped(external_id)
  JOIN device.list dl
    ON dl.organization_id = a.tenant_id
   AND dl.external_id = scoped.external_id
 WHERE a.scope ? 'device_ids';

UPDATE organization.assignments
   SET scope = scope - 'device_ids'
 WHERE scope ? 'device_ids';

DROP INDEX IF EXISTS organization.assignments_scope_device_ids_idx;
CREATE INDEX IF NOT EXISTS assignment_device_scope_by_device
    ON organization.assignment_device_scope (tenant_id, device_id);

CREATE OR REPLACE FUNCTION organization.fn_assignment_scope_external(
    p_assignment_id UUID,
    p_scope         JSONB
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN count(scope_row.device_id) = 0 THEN p_scope
        ELSE p_scope || jsonb_build_object(
            'device_ids',
            jsonb_agg(dl.external_id ORDER BY dl.external_id)
        )
    END
      FROM organization.assignment_device_scope scope_row
      JOIN device.list dl
        ON dl.organization_id = scope_row.tenant_id
       AND dl.id = scope_row.device_id
     WHERE scope_row.assignment_id = p_assignment_id;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE body dependency.
DROP FUNCTION IF EXISTS organization.fn_assignment_create(
    VARCHAR, VARCHAR, VARCHAR, UUID, JSONB, VARCHAR, TEXT, TEXT, TIMESTAMPTZ
);
CREATE FUNCTION organization.fn_assignment_create(
    p_tenant_id VARCHAR,
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
LANGUAGE plpgsql
AS $$
DECLARE
    v_assignment organization.assignments%ROWTYPE;
BEGIN
    INSERT INTO organization.assignments (
        tenant_id, subject_type, subject_id, persona_id, scope,
        created_by, reason, comment, expires_at
    ) VALUES (
        p_tenant_id, p_subject_type, p_subject_id, p_persona_id,
        p_scope - 'device_ids', p_created_by, p_reason, p_comment, p_expires_at
    ) RETURNING * INTO v_assignment;

    INSERT INTO organization.assignment_device_scope (
        assignment_id, tenant_id, device_id
    )
    SELECT v_assignment.id,
           p_tenant_id,
           organization.fn_resolve_device_id(
               p_tenant_id, scoped.external_id
           )
      FROM jsonb_array_elements_text(
          coalesce(p_scope->'device_ids', '[]'::JSONB)
      ) scoped(external_id)
    ON CONFLICT DO NOTHING;

    RETURN QUERY
    SELECT v_assignment.id::TEXT,
           v_assignment.tenant_id::TEXT,
           v_assignment.subject_type::VARCHAR,
           v_assignment.subject_id::TEXT,
           v_assignment.persona_id::TEXT,
           organization.fn_assignment_scope_external(
               v_assignment.id, v_assignment.scope
           ),
           v_assignment.created_at,
           v_assignment.created_by::TEXT,
           v_assignment.last_used_at,
           v_assignment.reason,
           v_assignment.comment,
           v_assignment.expires_at;
END;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE body dependency.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_subject(
    VARCHAR, VARCHAR, VARCHAR
);
CREATE FUNCTION organization.fn_assignment_list_for_subject(
    p_tenant_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT,
           organization.fn_assignment_scope_external(a.id, a.scope),
           a.created_at, a.created_by::TEXT, a.last_used_at,
           a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND a.subject_type = p_subject_type
       AND a.subject_id = p_subject_id
     ORDER BY a.created_at DESC;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE body dependency.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_persona(
    VARCHAR, UUID
);
CREATE FUNCTION organization.fn_assignment_list_for_persona(
    p_tenant_id VARCHAR,
    p_persona_id UUID
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT,
           organization.fn_assignment_scope_external(a.id, a.scope),
           a.created_at, a.created_by::TEXT, a.last_used_at,
           a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND a.persona_id = p_persona_id
     ORDER BY a.created_at DESC;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE body dependency.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_for_resource(
    VARCHAR, JSONB
);
CREATE FUNCTION organization.fn_assignment_list_for_resource(
    p_tenant_id VARCHAR,
    p_scope_probe JSONB
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT,
           organization.fn_assignment_scope_external(a.id, a.scope),
           a.created_at, a.created_by::TEXT, a.last_used_at,
           a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND (
           a.scope @> '{"all":true}'::JSONB
           OR (
               a.scope @> (p_scope_probe - 'device_ids')
               AND (
                   NOT (p_scope_probe ? 'device_ids')
                   OR EXISTS (
                       SELECT 1
                         FROM organization.assignment_device_scope scoped
                         JOIN device.list dl
                           ON dl.organization_id = scoped.tenant_id
                          AND dl.id = scoped.device_id
                        WHERE scoped.assignment_id = a.id
                          AND dl.external_id IN (
                              SELECT jsonb_array_elements_text(
                                  p_scope_probe->'device_ids'
                              )
                          )
                   )
               )
           )
       )
     ORDER BY a.created_at DESC;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before changing a RETURNS TABLE body dependency.
DROP FUNCTION IF EXISTS organization.fn_assignment_list_unused(VARCHAR, INT);
CREATE FUNCTION organization.fn_assignment_list_unused(
    p_tenant_id VARCHAR,
    p_threshold_days INT
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT,
           organization.fn_assignment_scope_external(a.id, a.scope),
           a.created_at, a.created_by::TEXT, a.last_used_at,
           a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND (
           a.last_used_at IS NULL
           OR a.last_used_at < now() - make_interval(days => p_threshold_days)
       )
     ORDER BY a.last_used_at NULLS FIRST, a.created_at;
$$;

--------------DOWN
UPDATE organization.assignments a
   SET scope = a.scope || jsonb_build_object(
       'device_ids',
       (
           SELECT jsonb_agg(dl.external_id ORDER BY dl.external_id)
             FROM organization.assignment_device_scope scoped
             JOIN device.list dl
               ON dl.organization_id = scoped.tenant_id
              AND dl.id = scoped.device_id
            WHERE scoped.assignment_id = a.id
       )
   )
 WHERE EXISTS (
     SELECT 1 FROM organization.assignment_device_scope scoped
      WHERE scoped.assignment_id = a.id
 );

CREATE OR REPLACE FUNCTION organization.fn_assignment_create(
    p_tenant_id VARCHAR,
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
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO organization.assignments (
        tenant_id, subject_type, subject_id, persona_id, scope,
        created_by, reason, comment, expires_at
    ) VALUES (
        p_tenant_id, p_subject_type, p_subject_id, p_persona_id, p_scope,
        p_created_by, p_reason, p_comment, p_expires_at
    )
    RETURNING assignments.id::TEXT,
              assignments.tenant_id::TEXT,
              assignments.subject_type,
              assignments.subject_id::TEXT,
              assignments.persona_id::TEXT,
              assignments.scope,
              assignments.created_at,
              assignments.created_by::TEXT,
              assignments.last_used_at,
              assignments.reason,
              assignments.comment,
              assignments.expires_at;
$$;

CREATE OR REPLACE FUNCTION organization.fn_assignment_list_for_subject(
    p_tenant_id VARCHAR,
    p_subject_type VARCHAR,
    p_subject_id VARCHAR
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT, a.scope, a.created_at, a.created_by::TEXT,
           a.last_used_at, a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND a.subject_type = p_subject_type
       AND a.subject_id = p_subject_id
     ORDER BY a.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION organization.fn_assignment_list_for_persona(
    p_tenant_id VARCHAR,
    p_persona_id UUID
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT, a.scope, a.created_at, a.created_by::TEXT,
           a.last_used_at, a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND a.persona_id = p_persona_id
     ORDER BY a.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION organization.fn_assignment_list_for_resource(
    p_tenant_id VARCHAR,
    p_scope_probe JSONB
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT, a.scope, a.created_at, a.created_by::TEXT,
           a.last_used_at, a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND (a.scope @> p_scope_probe OR a.scope @> '{"all":true}'::JSONB)
     ORDER BY a.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION organization.fn_assignment_list_unused(
    p_tenant_id VARCHAR,
    p_threshold_days INT
)
RETURNS TABLE (
    id TEXT, tenant_id TEXT, subject_type VARCHAR, subject_id TEXT,
    persona_id TEXT, scope JSONB, created_at TIMESTAMPTZ,
    created_by TEXT, last_used_at TIMESTAMPTZ, reason TEXT,
    comment TEXT, expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT a.id::TEXT, a.tenant_id::TEXT, a.subject_type, a.subject_id::TEXT,
           a.persona_id::TEXT, a.scope, a.created_at, a.created_by::TEXT,
           a.last_used_at, a.reason, a.comment, a.expires_at
      FROM organization.assignments a
     WHERE a.tenant_id = p_tenant_id
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND (
           a.last_used_at IS NULL
           OR a.last_used_at < now() - make_interval(days => p_threshold_days)
       )
     ORDER BY a.last_used_at NULLS FIRST, a.created_at;
$$;

DROP FUNCTION IF EXISTS organization.fn_assignment_scope_external(UUID, JSONB);
DROP TABLE IF EXISTS organization.assignment_device_scope;
DROP INDEX IF EXISTS organization.assignments_tenant_id_id_unique;
CREATE INDEX IF NOT EXISTS assignments_scope_device_ids_idx
    ON organization.assignments USING GIN ((scope -> 'device_ids'))
    WHERE scope ? 'device_ids';
