--------------UP
-- Promotes AuthzAuditComponent.list's dynamic WHERE-clause builder to a
-- single SQL function that accepts each filter as a nullable param.
-- Two scalars (count_only, limit/offset) keep the JS-side branching to
-- a single fn call per page render.

CREATE FUNCTION organization.fn_authz_audit_query(
    p_tenant_id    VARCHAR,
    p_from         TIMESTAMPTZ DEFAULT NULL,
    p_to           TIMESTAMPTZ DEFAULT NULL,
    p_actor_id     VARCHAR     DEFAULT NULL,
    p_action       VARCHAR     DEFAULT NULL,
    p_target_type  VARCHAR     DEFAULT NULL,
    p_target_id    VARCHAR     DEFAULT NULL,
    p_limit        INT         DEFAULT 200,
    p_offset       INT         DEFAULT 0
)
RETURNS TABLE (
    id          TEXT,
    tenant_id   TEXT,
    actor_id    VARCHAR,
    action      VARCHAR,
    target_type VARCHAR,
    target_id   TEXT,
    payload     JSONB,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, actor_id, action,
           target_type, target_id::text, payload, created_at
      FROM organization.authz_audit
     WHERE tenant_id = p_tenant_id
       AND (p_from        IS NULL OR created_at >= p_from)
       AND (p_to          IS NULL OR created_at <= p_to)
       AND (p_actor_id    IS NULL OR actor_id    = p_actor_id)
       AND (p_action      IS NULL OR action      = p_action)
       AND (p_target_type IS NULL OR target_type = p_target_type)
       AND (p_target_id   IS NULL OR target_id::text = p_target_id)
     ORDER BY created_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

-- Returns BIGINT: at 2.1B audit rows, an INT cast would silently
-- overflow. The component returns it as a JS number which safely
-- handles up to 2^53 — more than enough for any realistic audit log.
CREATE FUNCTION organization.fn_authz_audit_count(
    p_tenant_id    VARCHAR,
    p_from         TIMESTAMPTZ DEFAULT NULL,
    p_to           TIMESTAMPTZ DEFAULT NULL,
    p_actor_id     VARCHAR     DEFAULT NULL,
    p_action       VARCHAR     DEFAULT NULL,
    p_target_type  VARCHAR     DEFAULT NULL,
    p_target_id    VARCHAR     DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*)
      FROM organization.authz_audit
     WHERE tenant_id = p_tenant_id
       AND (p_from        IS NULL OR created_at >= p_from)
       AND (p_to          IS NULL OR created_at <= p_to)
       AND (p_actor_id    IS NULL OR actor_id    = p_actor_id)
       AND (p_action      IS NULL OR action      = p_action)
       AND (p_target_type IS NULL OR target_type = p_target_type)
       AND (p_target_id   IS NULL OR target_id::text = p_target_id);
$$;

--------------DOWN
DROP FUNCTION organization.fn_authz_audit_count;
DROP FUNCTION organization.fn_authz_audit_query;
