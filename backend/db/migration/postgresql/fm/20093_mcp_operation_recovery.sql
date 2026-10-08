--------------UP
-- Lease ownership makes abandoned executions visible without replaying them.
SET search_path TO public;

ALTER TABLE fm.mcp_operation
    ADD COLUMN executor_id UUID,
    ADD COLUMN lease_expires_at TIMESTAMPTZ;

CREATE INDEX mcp_operation_running_lease_idx
    ON fm.mcp_operation (lease_expires_at, id)
    WHERE status = 'running';

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

CREATE FUNCTION fm.fn_mcp_operation_claim(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_executor_id              UUID,
    p_lease_seconds            INTEGER
)
RETURNS TABLE (operation JSONB)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
        RAISE EXCEPTION 'MCP operation lease must be between 30 and 600 seconds';
    END IF;

    RETURN QUERY
    WITH updated AS (
        UPDATE fm.mcp_operation AS o
           SET status = 'running',
               executor_id = p_executor_id,
               lease_expires_at = clock_timestamp()
                   + make_interval(secs => p_lease_seconds),
               started_at = clock_timestamp(),
               updated_at = clock_timestamp()
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.status = 'reserved'
           AND o.expires_at > clock_timestamp()
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
END;
$$;

CREATE FUNCTION fm.fn_mcp_operation_can_execute(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_executor_id              UUID
)
RETURNS TABLE (can_execute BOOLEAN)
LANGUAGE sql
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM fm.mcp_operation AS o
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.status = 'running'
           AND o.executor_id = p_executor_id
           AND o.lease_expires_at > clock_timestamp()
    );
$$;

CREATE FUNCTION fm.fn_mcp_operation_settle_success(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_executor_id              UUID,
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
               finished_at = clock_timestamp(),
               updated_at = clock_timestamp(),
               expires_at = clock_timestamp()
                   + make_interval(secs => o.retention_seconds),
               lease_expires_at = NULL
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.executor_id = p_executor_id
           AND (
               o.status = 'running'
               OR (
                   o.status = 'outcome_unknown'
                   AND o.error_code = 'executor_lost'
               )
           )
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
$$;

CREATE FUNCTION fm.fn_mcp_operation_settle_failure(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_executor_id              UUID,
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
               finished_at = clock_timestamp(),
               updated_at = clock_timestamp(),
               expires_at = clock_timestamp()
                   + make_interval(secs => o.retention_seconds),
               lease_expires_at = NULL
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.executor_id = p_executor_id
           AND (
               o.status = 'running'
               OR (
                   o.status = 'outcome_unknown'
                   AND o.error_code = 'executor_lost'
               )
           )
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
$$;

CREATE FUNCTION fm.fn_mcp_operation_settle_unknown(
    p_id                       UUID,
    p_organization_id          VARCHAR,
    p_principal_user_id        VARCHAR,
    p_credential_identity_hash CHAR(64),
    p_executor_id              UUID,
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
               finished_at = clock_timestamp(),
               updated_at = clock_timestamp(),
               lease_expires_at = NULL
         WHERE o.id = p_id
           AND o.organization_id = p_organization_id
           AND o.principal_user_id = p_principal_user_id
           AND o.credential_identity_hash = p_credential_identity_hash
           AND o.executor_id = p_executor_id
           AND o.status = 'running'
        RETURNING o.*
    )
    SELECT fm.fn_mcp_operation_public(updated)
      FROM updated;
$$;

CREATE FUNCTION fm.fn_mcp_operation_maintain(
    p_executor_id         UUID,
    p_active_operation_ids UUID[],
    p_recover_owned        BOOLEAN,
    p_lease_seconds        INTEGER,
    p_batch_size           INTEGER
)
RETURNS TABLE (
    leases_renewed INTEGER,
    orphaned INTEGER,
    purged INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_leases_renewed INTEGER;
    v_orphaned INTEGER;
    v_purged INTEGER;
BEGIN
    IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
        RAISE EXCEPTION 'MCP operation lease must be between 30 and 600 seconds';
    END IF;
    IF p_batch_size < 1 OR p_batch_size > 1000 THEN
        RAISE EXCEPTION 'MCP operation maintenance batch must be between 1 and 1000';
    END IF;
    IF cardinality(COALESCE(p_active_operation_ids, ARRAY[]::UUID[]))
        > p_batch_size THEN
        RAISE EXCEPTION 'MCP active operation batch exceeds maintenance batch size';
    END IF;

    WITH due AS (
        SELECT o.id
          FROM fm.mcp_operation AS o
         WHERE o.status = 'running'
           AND o.executor_id = p_executor_id
           AND o.id = ANY(COALESCE(p_active_operation_ids, ARRAY[]::UUID[]))
           AND (
               o.lease_expires_at IS NULL
               OR o.lease_expires_at <= clock_timestamp()
                   + make_interval(secs => p_lease_seconds / 2)
           )
         ORDER BY o.lease_expires_at NULLS FIRST, o.id
         LIMIT p_batch_size
         FOR UPDATE SKIP LOCKED
    ), renewed AS (
        UPDATE fm.mcp_operation AS o
           SET lease_expires_at = clock_timestamp()
                   + make_interval(secs => p_lease_seconds),
               updated_at = clock_timestamp()
          FROM due
         WHERE o.id = due.id
        RETURNING o.id
    )
    SELECT count(*)::INTEGER INTO v_leases_renewed FROM renewed;

    WITH stale AS (
        SELECT o.id
         FROM fm.mcp_operation AS o
         WHERE o.status = 'running'
           AND (
               o.lease_expires_at <= clock_timestamp()
               OR (
                   o.lease_expires_at IS NULL
                   AND o.started_at <= clock_timestamp()
                       - make_interval(secs => p_lease_seconds)
               )
           )
           AND (
               o.executor_id IS DISTINCT FROM p_executor_id
               OR (
                   p_recover_owned
                   AND o.executor_id = p_executor_id
                   AND NOT (
                       o.id = ANY(
                           COALESCE(
                               p_active_operation_ids,
                               ARRAY[]::UUID[]
                           )
                       )
                   )
               )
           )
         ORDER BY o.lease_expires_at NULLS FIRST, o.started_at, o.id
         LIMIT p_batch_size
         FOR UPDATE SKIP LOCKED
    ), marked AS (
        UPDATE fm.mcp_operation AS o
           SET status = 'outcome_unknown',
               result = NULL,
               result_truncated = FALSE,
               error_code = 'executor_lost',
               outcome_summary =
                   'The executor lease expired before the outcome was recorded.',
               finished_at = clock_timestamp(),
               updated_at = clock_timestamp(),
               lease_expires_at = NULL
          FROM stale
         WHERE o.id = stale.id
        RETURNING o.id
    )
    SELECT count(*)::INTEGER INTO v_orphaned FROM marked;

    WITH expired AS (
        SELECT o.id
          FROM fm.mcp_operation AS o
         WHERE o.expires_at <= clock_timestamp()
           AND o.status IN ('reserved', 'succeeded', 'failed')
         ORDER BY o.expires_at, o.id
         LIMIT p_batch_size
         FOR UPDATE SKIP LOCKED
    ), deleted AS (
        DELETE FROM fm.mcp_operation AS o
         USING expired
         WHERE o.id = expired.id
        RETURNING o.id
    )
    SELECT count(*)::INTEGER INTO v_purged FROM deleted;

    RETURN QUERY SELECT v_leases_renewed, v_orphaned, v_purged;
END;
$$;

CREATE FUNCTION fm.fn_mcp_operation_release(
    p_executor_id UUID,
    p_batch_size  INTEGER
)
RETURNS TABLE (released INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_released INTEGER;
BEGIN
    IF p_batch_size < 1 OR p_batch_size > 1000 THEN
        RAISE EXCEPTION 'MCP operation release batch must be between 1 and 1000';
    END IF;

    WITH owned AS (
        SELECT o.id
          FROM fm.mcp_operation AS o
         WHERE o.status = 'running'
           AND o.executor_id = p_executor_id
         ORDER BY o.id
         LIMIT p_batch_size
         FOR UPDATE SKIP LOCKED
    ), marked AS (
        UPDATE fm.mcp_operation AS o
           SET status = 'outcome_unknown',
               result = NULL,
               result_truncated = FALSE,
               error_code = 'executor_lost',
               outcome_summary =
                   'The executor stopped before the outcome was recorded.',
               finished_at = clock_timestamp(),
               updated_at = clock_timestamp(),
               lease_expires_at = NULL
          FROM owned
         WHERE o.id = owned.id
        RETURNING o.id
    )
    SELECT count(*)::INTEGER INTO v_released FROM marked;

    RETURN QUERY SELECT v_released;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_release(UUID, INTEGER);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_maintain(
    UUID, UUID[], BOOLEAN, INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_settle_unknown(
    UUID, VARCHAR, VARCHAR, CHAR, UUID, VARCHAR
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_settle_failure(
    UUID, VARCHAR, VARCHAR, CHAR, UUID, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_settle_success(
    UUID, VARCHAR, VARCHAR, CHAR, UUID, JSONB, BOOLEAN
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_can_execute(
    UUID, VARCHAR, VARCHAR, CHAR, UUID
);
DROP FUNCTION IF EXISTS fm.fn_mcp_operation_claim(
    UUID, VARCHAR, VARCHAR, CHAR, UUID, INTEGER
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
            'retention_seconds'
          ];
$$;

DROP INDEX IF EXISTS fm.mcp_operation_running_lease_idx;

ALTER TABLE fm.mcp_operation
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS executor_id;
