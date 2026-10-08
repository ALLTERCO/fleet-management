--------------UP
-- Private recovery context links an interrupted receipt to an authoritative
-- domain job without exposing replay parameters through the public receipt.
SET search_path TO public;

ALTER TABLE fm.mcp_operation
    ADD COLUMN recovery_adapter VARCHAR(40),
    ADD COLUMN recovery_context JSONB,
    ADD COLUMN domain_job_id UUID,
    ADD CONSTRAINT mcp_operation_recovery_pair_chk CHECK (
        (recovery_adapter IS NULL AND recovery_context IS NULL)
        OR (
            recovery_adapter IN (
                'backup_job',
                'firmware_job',
                'file_transfer_finalize'
            )
            AND jsonb_typeof(recovery_context) = 'object'
        )
    );

CREATE OR REPLACE FUNCTION fm.fn_mcp_operation_public(
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
            'retention_seconds',
            'executor_id',
            'lease_expires_at',
            'recovery_adapter',
            'recovery_context',
            'domain_job_id'
          ];
$$;

CREATE FUNCTION fm.fn_mcp_operation_register_recovery(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_recovery_adapter         VARCHAR,
    p_recovery_context         JSONB
)
RETURNS TABLE (
    operation JSONB,
    recovery_adapter VARCHAR,
    recovery_context JSONB,
    domain_job_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_recovery_adapter NOT IN (
        'backup_job',
        'firmware_job',
        'file_transfer_finalize'
    ) THEN
        RAISE EXCEPTION 'unsupported MCP operation recovery adapter';
    END IF;
    IF jsonb_typeof(p_recovery_context) IS DISTINCT FROM 'object'
        OR octet_length(p_recovery_context::text) > 32768 THEN
        RAISE EXCEPTION 'invalid MCP operation recovery context';
    END IF;

    RETURN QUERY
    WITH updated AS (
        UPDATE fm.mcp_operation AS o
           SET recovery_adapter = p_recovery_adapter,
               recovery_context = p_recovery_context,
               updated_at = clock_timestamp()
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.status = 'reserved'
           AND (
               o.recovery_adapter IS NULL
               OR (
                   o.recovery_adapter = p_recovery_adapter
                   AND o.recovery_context = p_recovery_context
               )
           )
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated),
           updated.recovery_adapter,
           updated.recovery_context,
           updated.domain_job_id
      FROM updated;
END;
$$;

CREATE FUNCTION fm.fn_mcp_operation_recovery_get(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64)
)
RETURNS TABLE (
    operation JSONB,
    recovery_adapter VARCHAR,
    recovery_context JSONB,
    domain_job_id UUID
)
LANGUAGE sql STABLE
AS $$
    SELECT fm.fn_mcp_operation_public(o),
           o.recovery_adapter,
           o.recovery_context,
           o.domain_job_id
      FROM fm.mcp_operation AS o
     WHERE o.id = p_id
       AND o.organization_id = p_organization_id
       AND o.principal_user_id = p_principal_user_id
       AND o.credential_identity_hash = p_credential_identity_hash
       AND o.recovery_adapter IS NOT NULL;
$$;

CREATE FUNCTION fm.fn_mcp_operation_link_recovery_job(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_executor_id              UUID,
    p_job_id                   UUID
)
RETURNS TABLE (
    operation JSONB,
    recovery_adapter VARCHAR,
    recovery_context JSONB,
    domain_job_id UUID
)
LANGUAGE sql
AS $$
    WITH updated AS (
        UPDATE fm.mcp_operation AS o
           SET domain_job_id = p_job_id,
               updated_at = clock_timestamp()
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.executor_id = p_executor_id
           AND o.recovery_adapter IN ('backup_job', 'firmware_job')
           AND (o.domain_job_id IS NULL OR o.domain_job_id = p_job_id)
           AND (
               (
                   o.recovery_adapter = 'backup_job'
                   AND EXISTS (
                       SELECT 1
                         FROM organization.backup_jobs AS j
                        WHERE j.id = p_job_id
                          AND j.tenant_id = p_organization_id
                   )
               )
               OR (
                   o.recovery_adapter = 'firmware_job'
                   AND EXISTS (
                       SELECT 1
                         FROM organization.firmware_jobs AS j
                        WHERE j.id = p_job_id
                          AND j.tenant_id = p_organization_id
                   )
               )
           )
           AND (
               o.status = 'running'
               OR (
                   o.status = 'outcome_unknown'
                   AND o.error_code = 'executor_lost'
               )
           )
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated),
           updated.recovery_adapter,
           updated.recovery_context,
           updated.domain_job_id
      FROM updated;
$$;

CREATE FUNCTION fm.fn_mcp_operation_find_recovery_job(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64)
)
RETURNS TABLE (job_id TEXT)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_adapter VARCHAR;
    v_domain_key VARCHAR;
BEGIN
    SELECT o.recovery_adapter,
           o.recovery_context ->> 'domainIdempotencyKey'
      INTO v_adapter, v_domain_key
      FROM fm.mcp_operation AS o
     WHERE o.id = p_id
       AND o.organization_id = p_organization_id
       AND o.principal_user_id = p_principal_user_id
       AND o.credential_identity_hash = p_credential_identity_hash;

    IF v_adapter = 'backup_job' THEN
        RETURN QUERY
        SELECT j.id::text
          FROM organization.backup_jobs AS j
         WHERE j.tenant_id = p_organization_id
           AND j.idempotency_key = v_domain_key
         LIMIT 1;
    ELSIF v_adapter = 'firmware_job' THEN
        RETURN QUERY
        SELECT j.id::text
          FROM organization.firmware_jobs AS j
         WHERE j.tenant_id = p_organization_id
           AND j.idempotency_key = v_domain_key
         LIMIT 1;
    END IF;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_find_recovery_job(
    UUID, VARCHAR, VARCHAR, CHAR
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_link_recovery_job(
    UUID, VARCHAR, VARCHAR, CHAR, UUID, UUID
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_recovery_get(
    UUID, VARCHAR, VARCHAR, CHAR
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_register_recovery(
    UUID, VARCHAR, VARCHAR, CHAR, VARCHAR, JSONB
);

ALTER TABLE fm.mcp_operation
    DROP CONSTRAINT IF EXISTS mcp_operation_recovery_pair_chk,
    DROP COLUMN IF EXISTS domain_job_id,
    DROP COLUMN IF EXISTS recovery_context,
    DROP COLUMN IF EXISTS recovery_adapter;

CREATE OR REPLACE FUNCTION fm.fn_mcp_operation_public(
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
            'retention_seconds',
            'executor_id',
            'lease_expires_at'
          ];
$$;
