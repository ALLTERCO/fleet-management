--------------UP
-- CredentialComponent raw-SQL → fn_*. The advisory-lock + read + push
-- chain is collapsed into fn_credential_stage_push so callers no longer
-- open a JS-side withQueryTransaction.

CREATE FUNCTION organization.fn_credential_list(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_status    VARCHAR,
    p_limit     INT,
    p_offset    INT
)
RETURNS TABLE (
    id                   TEXT,
    tenant_id            TEXT,
    device_id            VARCHAR,
    username             VARCHAR,
    realm                VARCHAR,
    rotated_at           TIMESTAMPTZ,
    rotated_by           VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error  TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, device_id, username, realm,
           rotated_at, rotated_by, last_rotation_status, last_rotation_error
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id
       AND (p_device_id IS NULL OR device_id = p_device_id)
       AND (p_status    IS NULL OR last_rotation_status = p_status)
     ORDER BY rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE FUNCTION organization.fn_credential_get(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR
)
RETURNS TABLE (
    id                   TEXT,
    tenant_id            TEXT,
    device_id            VARCHAR,
    username             VARCHAR,
    realm                VARCHAR,
    rotated_at           TIMESTAMPTZ,
    rotated_by           VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error  TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, device_id, username, realm,
           rotated_at, rotated_by, last_rotation_status, last_rotation_error
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id AND device_id = p_device_id;
$$;

CREATE FUNCTION organization.fn_credential_reveal_count_24h(
    p_tenant_id VARCHAR,
    p_actor_id  VARCHAR
)
RETURNS INT
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*)::int
      FROM organization.credential_reveal_audit
     WHERE tenant_id = p_tenant_id
       AND actor_id = p_actor_id
       AND revealed_at > now() - interval '24 hours';
$$;

CREATE FUNCTION organization.fn_credential_get_password(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR
)
RETURNS TABLE (
    password_encrypted TEXT,
    realm              VARCHAR,
    username           VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT password_encrypted, realm, username
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id AND device_id = p_device_id;
$$;

CREATE FUNCTION organization.fn_credential_reveal_audit(
    p_tenant_id     VARCHAR,
    p_actor_id      VARCHAR,
    p_device_id     VARCHAR,
    p_justification TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO organization.credential_reveal_audit
        (tenant_id, actor_id, device_id, justification)
    VALUES (p_tenant_id, p_actor_id, p_device_id, p_justification);
$$;

CREATE FUNCTION organization.fn_credential_job_create(
    p_tenant_id  VARCHAR,
    p_target     JSONB,
    p_mode       VARCHAR,
    p_created_by VARCHAR
)
RETURNS TABLE (id TEXT)
LANGUAGE sql
AS $$
    INSERT INTO organization.credential_jobs
        (tenant_id, target_summary, mode, status, started_at, created_by)
    VALUES (p_tenant_id, p_target, p_mode, 'running', now(), p_created_by)
    RETURNING id::text;
$$;

-- Atomic stage: takes a per-(tenant, device) advisory lock so concurrent
-- callers can't race on ha1_old_hex, reads the prior ha1, inserts a new
-- credential_pushes row, returns its id. Lock auto-releases at COMMIT.
CREATE FUNCTION organization.fn_credential_stage_push(
    p_job_id              UUID,
    p_tenant_id           VARCHAR,
    p_device_id           VARCHAR,
    p_ha1_new_hex         VARCHAR,
    p_password_encrypted  TEXT,
    p_requested_by        VARCHAR
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_ha1 VARCHAR;
    v_push_id INT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id), hashtext(p_device_id));

    SELECT ha1_hex INTO v_old_ha1
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id AND device_id = p_device_id;

    INSERT INTO organization.credential_pushes
        (job_id, tenant_id, device_id, status,
         ha1_old_hex, ha1_new_hex, password_encrypted, requested_by)
    VALUES
        (p_job_id, p_tenant_id, p_device_id, 'queued',
         v_old_ha1, p_ha1_new_hex, p_password_encrypted, p_requested_by)
    RETURNING id INTO v_push_id;

    RETURN v_push_id;
END;
$$;

CREATE FUNCTION organization.fn_credential_list_flagged_ids(
    p_tenant_id  VARCHAR,
    p_device_ids VARCHAR[]
)
RETURNS TABLE (device_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT device_id
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id
       AND device_id = ANY(p_device_ids)
       AND last_rotation_status <> 'ok';
$$;

CREATE FUNCTION organization.fn_credential_clear_rows(
    p_tenant_id  VARCHAR,
    p_device_ids VARCHAR[]
)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id
       AND device_id = ANY(p_device_ids);
$$;

CREATE FUNCTION organization.fn_credential_retry_push(
    p_push_id   INT,
    p_tenant_id VARCHAR
)
RETURNS TABLE (id INT, job_id TEXT, device_id VARCHAR)
LANGUAGE sql
AS $$
    UPDATE organization.credential_pushes
       SET status = 'queued',
           last_error = NULL,
           retry_count = retry_count + 1
     WHERE id = p_push_id
       AND tenant_id = p_tenant_id
       AND status IN ('failed', 'unknown')
    RETURNING id, job_id::text, device_id;
$$;

CREATE FUNCTION organization.fn_credential_confirm_old(
    p_push_id   INT,
    p_tenant_id VARCHAR
)
RETURNS TABLE (device_id VARCHAR, ha1_old_hex VARCHAR)
LANGUAGE sql
AS $$
    UPDATE organization.credential_pushes p
       SET status = 'ok'
      FROM organization.credential_jobs j
     WHERE p.id = p_push_id
       AND p.job_id = j.id
       AND j.tenant_id = p_tenant_id
       AND p.status IN ('failed', 'unknown')
    RETURNING p.device_id, p.ha1_old_hex;
$$;

CREATE FUNCTION organization.fn_credential_rollback_to_old(
    p_tenant_id   VARCHAR,
    p_device_id   VARCHAR,
    p_ha1_old_hex VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE organization.device_credentials
       SET ha1_hex = p_ha1_old_hex,
           last_rotation_status = 'ok',
           last_rotation_error = NULL
     WHERE tenant_id = p_tenant_id AND device_id = p_device_id;
$$;

CREATE FUNCTION organization.fn_credential_list_failed(
    p_tenant_id VARCHAR,
    p_limit     INT,
    p_offset    INT
)
RETURNS TABLE (
    id                   TEXT,
    tenant_id            TEXT,
    device_id            VARCHAR,
    username             VARCHAR,
    realm                VARCHAR,
    rotated_at           TIMESTAMPTZ,
    rotated_by           VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error  TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, device_id, username, realm,
           rotated_at, rotated_by, last_rotation_status, last_rotation_error
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id AND last_rotation_status <> 'ok'
     ORDER BY rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE FUNCTION organization.fn_credential_job_status(
    p_job_id    UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (
    id             TEXT,
    tenant_id      TEXT,
    target_summary JSONB,
    mode           VARCHAR,
    status         VARCHAR,
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ,
    created_by     VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, target_summary, mode,
           status, started_at, finished_at, created_at, created_by
      FROM organization.credential_jobs
     WHERE id = p_job_id AND tenant_id = p_tenant_id;
$$;

CREATE FUNCTION organization.fn_credential_push_rows_by_job(
    p_job_id UUID
)
RETURNS TABLE (
    id            INT,
    job_id        TEXT,
    device_id     VARCHAR,
    status        VARCHAR,
    last_error    TEXT,
    applied_at    TIMESTAMPTZ,
    picked_up_at  TIMESTAMPTZ,
    retry_count   INT,
    requested_by  VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT id, job_id::text, device_id, status, last_error,
           applied_at, picked_up_at, retry_count, requested_by
      FROM organization.credential_pushes
     WHERE job_id = p_job_id
     ORDER BY id ASC;
$$;

CREATE FUNCTION organization.fn_credential_list_pushes(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_job_id    UUID,
    p_status    VARCHAR,
    p_limit     INT,
    p_offset    INT
)
RETURNS TABLE (
    id            INT,
    job_id        TEXT,
    device_id     VARCHAR,
    status        VARCHAR,
    last_error    TEXT,
    applied_at    TIMESTAMPTZ,
    picked_up_at  TIMESTAMPTZ,
    retry_count   INT,
    requested_by  VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.job_id::text, p.device_id, p.status, p.last_error,
           p.applied_at, p.picked_up_at, p.retry_count, p.requested_by
      FROM organization.credential_pushes p
     WHERE p.tenant_id = p_tenant_id
       AND (p_device_id IS NULL OR p.device_id = p_device_id)
       AND (p_job_id    IS NULL OR p.job_id    = p_job_id)
       AND (p_status    IS NULL OR p.status    = p_status)
     ORDER BY p.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

--------------DOWN
DROP FUNCTION organization.fn_credential_list_pushes;
DROP FUNCTION organization.fn_credential_push_rows_by_job;
DROP FUNCTION organization.fn_credential_job_status;
DROP FUNCTION organization.fn_credential_list_failed;
DROP FUNCTION organization.fn_credential_rollback_to_old;
DROP FUNCTION organization.fn_credential_confirm_old;
DROP FUNCTION organization.fn_credential_retry_push;
DROP FUNCTION organization.fn_credential_clear_rows;
DROP FUNCTION organization.fn_credential_list_flagged_ids;
DROP FUNCTION organization.fn_credential_stage_push;
DROP FUNCTION organization.fn_credential_job_create;
DROP FUNCTION organization.fn_credential_reveal_audit;
DROP FUNCTION organization.fn_credential_get_password;
DROP FUNCTION organization.fn_credential_reveal_count_24h;
DROP FUNCTION organization.fn_credential_get;
DROP FUNCTION organization.fn_credential_list;
