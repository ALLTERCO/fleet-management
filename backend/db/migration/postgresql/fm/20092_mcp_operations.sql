--------------UP
-- Durable MCP write receipts. A reservation prevents concurrent duplicate
-- execution, while running and unknown outcomes require reconciliation.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS fm.mcp_operation (
    id                       UUID PRIMARY KEY,
    organization_id          VARCHAR(120) NOT NULL,
    principal_user_id        VARCHAR(255) NOT NULL,
    credential_identity_hash CHAR(64) NOT NULL,
    idempotency_key_hash     CHAR(64) NOT NULL,
    method                   VARCHAR(250) NOT NULL,
    params_hash              CHAR(64) NOT NULL,
    status                   VARCHAR(24) NOT NULL DEFAULT 'reserved'
        CHECK (status IN (
            'reserved',
            'running',
            'succeeded',
            'failed',
            'outcome_unknown'
        )),
    result                   JSONB,
    result_truncated         BOOLEAN NOT NULL DEFAULT FALSE,
    error_code               VARCHAR(100),
    outcome_summary          VARCHAR(1000),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at               TIMESTAMPTZ,
    finished_at              TIMESTAMPTZ,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    retention_seconds        INTEGER NOT NULL
        CHECK (retention_seconds BETWEEN 60 AND 604800),
    expires_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (
        organization_id,
        principal_user_id,
        credential_identity_hash,
        idempotency_key_hash
    )
);

CREATE INDEX IF NOT EXISTS mcp_operation_expires_at_idx
    ON fm.mcp_operation (expires_at);

CREATE FUNCTION fm.fn_mcp_operation_public(
    p_operation fm.mcp_operation
)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
    SELECT to_jsonb(p_operation)
        - ARRAY[
            'credential_identity_hash',
            'idempotency_key_hash',
            'params_hash',
            'retention_seconds'
          ];
$$;

CREATE FUNCTION fm.fn_mcp_operation_reserve(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id         VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_idempotency_key_hash     CHAR(64),
    p_method                   VARCHAR,
    p_params_hash              CHAR(64),
    p_retention_seconds        INTEGER
)
RETURNS TABLE (
    operation JSONB,
    created BOOLEAN,
    binding_matched BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_operation fm.mcp_operation%ROWTYPE;
BEGIN
    IF p_retention_seconds < 60 OR p_retention_seconds > 604800 THEN
        RAISE EXCEPTION 'MCP operation retention must be between 60 and 604800 seconds';
    END IF;

    DELETE FROM fm.mcp_operation AS o
     WHERE o.organization_id = p_organization_id
       AND o.principal_user_id = p_principal_user_id
       AND o.credential_identity_hash = p_credential_identity_hash
       AND o.idempotency_key_hash = p_idempotency_key_hash
       AND o.status IN ('reserved', 'succeeded', 'failed')
       AND o.expires_at <= now();

    WITH expired AS (
        SELECT o.id
         FROM fm.mcp_operation AS o
         WHERE o.expires_at <= now()
           AND o.status IN ('reserved', 'succeeded', 'failed')
         ORDER BY o.expires_at, o.id
         LIMIT 100
         FOR UPDATE SKIP LOCKED
    )
    DELETE FROM fm.mcp_operation AS o
     USING expired
     WHERE o.id = expired.id;

    INSERT INTO fm.mcp_operation AS o (
        id,
        organization_id,
        principal_user_id,
        credential_identity_hash,
        idempotency_key_hash,
        method,
        params_hash,
        retention_seconds,
        expires_at
    )
    VALUES (
        p_id,
        p_organization_id,
        p_principal_user_id,
        p_credential_identity_hash,
        p_idempotency_key_hash,
        p_method,
        p_params_hash,
        p_retention_seconds,
        now() + make_interval(secs => p_retention_seconds)
    )
    ON CONFLICT (
        organization_id,
        principal_user_id,
        credential_identity_hash,
        idempotency_key_hash
    ) DO NOTHING
    RETURNING o.* INTO v_operation;

    IF FOUND THEN
        RETURN QUERY
        SELECT fm.fn_mcp_operation_public(v_operation), TRUE, TRUE;
        RETURN;
    END IF;

    SELECT o.*
      INTO v_operation
      FROM fm.mcp_operation AS o
     WHERE o.organization_id = p_organization_id
       AND o.principal_user_id = p_principal_user_id
       AND o.credential_identity_hash = p_credential_identity_hash
       AND o.idempotency_key_hash = p_idempotency_key_hash;

    IF v_operation.id IS NULL THEN
        RETURN QUERY SELECT NULL::JSONB, FALSE, FALSE;
        RETURN;
    END IF;

    IF v_operation.method <> p_method OR v_operation.params_hash <> p_params_hash THEN
        RETURN QUERY SELECT NULL::JSONB, FALSE, FALSE;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT fm.fn_mcp_operation_public(v_operation), FALSE, TRUE;
END;
$$;

CREATE FUNCTION fm.fn_mcp_operation_get(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id         VARCHAR,
    p_credential_identity_hash CHAR(64)
)
RETURNS TABLE (operation JSONB)
LANGUAGE sql STABLE
AS $$
    SELECT fm.fn_mcp_operation_public(o)
      FROM fm.mcp_operation AS o
     WHERE o.id = p_id
       AND o.organization_id = p_organization_id
       AND o.principal_user_id = p_principal_user_id
       AND o.credential_identity_hash = p_credential_identity_hash
       AND (
           o.expires_at > now()
           OR o.status IN ('running', 'outcome_unknown')
       );
$$;

CREATE FUNCTION fm.fn_mcp_operation_start(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id         VARCHAR,
    p_credential_identity_hash CHAR(64)
)
RETURNS TABLE (operation JSONB)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE fm.mcp_operation AS o
           SET status = 'running',
               started_at = now(),
               updated_at = now()
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.status = 'reserved'
           AND o.expires_at > now()
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
$$;

CREATE FUNCTION fm.fn_mcp_operation_succeed(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id         VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_result                   JSONB,
    p_result_truncated         BOOLEAN
)
RETURNS TABLE (operation JSONB)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE fm.mcp_operation AS o
           SET status = 'succeeded',
               result = p_result,
               result_truncated = p_result_truncated,
               error_code = NULL,
               outcome_summary = NULL,
               finished_at = now(),
               updated_at = now(),
               expires_at = now() + make_interval(secs => o.retention_seconds)
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.status = 'running'
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
$$;

CREATE FUNCTION fm.fn_mcp_operation_fail(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id         VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_error_code               VARCHAR,
    p_outcome_summary          VARCHAR
)
RETURNS TABLE (operation JSONB)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE fm.mcp_operation AS o
           SET status = 'failed',
               result = NULL,
               result_truncated = FALSE,
               error_code = p_error_code,
               outcome_summary = p_outcome_summary,
               finished_at = now(),
               updated_at = now(),
               expires_at = now() + make_interval(secs => o.retention_seconds)
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.status = 'running'
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
$$;

CREATE FUNCTION fm.fn_mcp_operation_mark_unknown(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id         VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_outcome_summary          VARCHAR
)
RETURNS TABLE (operation JSONB)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE fm.mcp_operation AS o
           SET status = 'outcome_unknown',
               result = NULL,
               result_truncated = FALSE,
               error_code = NULL,
               outcome_summary = p_outcome_summary,
               finished_at = now(),
               updated_at = now()
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.status = 'running'
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_mark_unknown(
    UUID, VARCHAR, VARCHAR, CHAR, VARCHAR
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_fail(
    UUID, VARCHAR, VARCHAR, CHAR, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_succeed(
    UUID, VARCHAR, VARCHAR, CHAR, JSONB, BOOLEAN
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_start(UUID, VARCHAR, VARCHAR, CHAR);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_get(UUID, VARCHAR, VARCHAR, CHAR);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_reserve(
    UUID, VARCHAR, VARCHAR, CHAR, CHAR, VARCHAR, CHAR, INTEGER
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_public(fm.mcp_operation);
DROP TABLE IF EXISTS fm.mcp_operation;
