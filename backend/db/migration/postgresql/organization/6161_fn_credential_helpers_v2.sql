--------------UP
-- Credential pipeline gap fixes from the audit:
--   * fn_credential_job_create defaults status='queued' so markJobRunning
--     becomes meaningful (was hardcoded 'running' → markJobRunning no-op).
--   * fn_credential_confirm_old handles first-ever-push: when the row's
--     ha1_old_hex IS NULL there's nothing to roll back to, so DELETE the
--     device_credentials row instead of leaving it stuck failed.
--   * fn_credential_finalize_ok / fn_credential_finalize_failed: pushWorker
--     was writing device_credentials via raw SQL — move it into fn_* so
--     schema changes don't need TS edits.
--   * CHECK constraint: a 'queued' row can't carry picked_up_at (state
--     machine invariant). Hardens against bugs that select-without-update.

SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_credential_job_create(VARCHAR, JSONB, VARCHAR, VARCHAR);

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
    VALUES (p_tenant_id, p_target, p_mode, 'queued', NULL, p_created_by)
    RETURNING id::text;
$$;

-- pushWorker calls these after a successful / failed device push so the
-- raw INSERT/UPDATE used to live in TS. Single source of truth now.
CREATE OR REPLACE FUNCTION organization.fn_credential_finalize_ok(
    p_tenant_id           VARCHAR,
    p_device_id           VARCHAR,
    p_password_encrypted  TEXT,
    p_ha1_hex             VARCHAR,
    p_rotated_by          VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO organization.device_credentials
        (tenant_id, device_id, username, realm,
         password_encrypted, ha1_hex,
         rotated_at, rotated_by,
         last_rotation_status, last_rotation_error)
    VALUES (p_tenant_id, p_device_id, 'admin', p_device_id,
        p_password_encrypted, p_ha1_hex,
        now(), p_rotated_by, 'ok', NULL)
    ON CONFLICT (tenant_id, device_id) DO UPDATE SET
        password_encrypted = EXCLUDED.password_encrypted,
        ha1_hex            = EXCLUDED.ha1_hex,
        rotated_at         = now(),
        rotated_by         = EXCLUDED.rotated_by,
        last_rotation_status = 'ok',
        last_rotation_error  = NULL;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_finalize_failed(
    p_tenant_id  VARCHAR,
    p_device_id  VARCHAR,
    p_error      TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
    -- Mark status only; preserve password_encrypted / ha1_hex from prior
    -- successful push so the operator can still reach the device with
    -- the OLD password while we sort out the new one.
    UPDATE organization.device_credentials
       SET last_rotation_status = 'failed',
           last_rotation_error  = p_error
     WHERE tenant_id = p_tenant_id
       AND device_id = p_device_id;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_confirm_old(INT, VARCHAR);

CREATE FUNCTION organization.fn_credential_confirm_old(
    p_push_id   INT,
    p_tenant_id VARCHAR
)
RETURNS TABLE (device_id VARCHAR, ha1_old_hex VARCHAR)
LANGUAGE plpgsql
AS $$
DECLARE
    v_device_id   VARCHAR;
    v_ha1_old_hex VARCHAR;
BEGIN
    UPDATE organization.credential_pushes p
       SET status = 'ok'
      FROM organization.credential_jobs j
     WHERE p.id = p_push_id
       AND p.job_id = j.id
       AND j.tenant_id = p_tenant_id
       AND p.status IN ('failed', 'unknown')
    RETURNING p.device_id, p.ha1_old_hex
        INTO v_device_id, v_ha1_old_hex;

    IF v_device_id IS NULL THEN
        RETURN;
    END IF;

    -- First-ever push case: no prior ha1 to roll back to, so the
    -- device_credentials row from the failed-new attempt is orphan
    -- data. Delete it; operator can re-issue Set when ready.
    IF v_ha1_old_hex IS NULL THEN
        DELETE FROM organization.device_credentials
         WHERE tenant_id = p_tenant_id
           AND device_id = v_device_id;
    END IF;

    RETURN QUERY SELECT v_device_id, v_ha1_old_hex;
END;
$$;

-- State-machine invariant: queued rows are not yet picked up.
ALTER TABLE organization.credential_pushes
    ADD CONSTRAINT credential_pushes_queued_not_picked_chk
        CHECK (status <> 'queued' OR picked_up_at IS NULL);

--------------DOWN
SET search_path TO organization;
ALTER TABLE organization.credential_pushes
    DROP CONSTRAINT IF EXISTS credential_pushes_queued_not_picked_chk;
DROP FUNCTION IF EXISTS organization.fn_credential_finalize_failed(VARCHAR, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS organization.fn_credential_finalize_ok(
    VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS organization.fn_credential_confirm_old(INT, VARCHAR);
-- 6141's original confirm_old comes back via re-running that migration's
-- UP block manually if needed; restoring it inline here would duplicate.
DROP FUNCTION IF EXISTS organization.fn_credential_job_create(VARCHAR, JSONB, VARCHAR, VARCHAR);
