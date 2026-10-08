--------------UP
ALTER TABLE organization.backup_jobs
    ADD COLUMN IF NOT EXISTS control_state VARCHAR NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS authority JSONB;

ALTER TABLE organization.firmware_jobs
    ADD COLUMN IF NOT EXISTS control_state VARCHAR NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS authority JSONB;

ALTER TABLE organization.backup_units
    ADD COLUMN IF NOT EXISTS execution_id UUID,
    ADD COLUMN IF NOT EXISTS dispatch_state VARCHAR NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS outcome_state VARCHAR NOT NULL DEFAULT 'active';

ALTER TABLE organization.firmware_units
    ADD COLUMN IF NOT EXISTS execution_id UUID,
    ADD COLUMN IF NOT EXISTS dispatch_state VARCHAR NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS outcome_state VARCHAR NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS backup_units_control_idx
    ON organization.backup_units (job_id, outcome_state, dispatch_state);

CREATE INDEX IF NOT EXISTS firmware_units_control_idx
    ON organization.firmware_units (job_id, outcome_state, dispatch_state);

UPDATE organization.backup_units
   SET dispatch_state = 'dispatched', outcome_state = 'unknown', phase = 'unknown'
 WHERE status = 'in_progress';
UPDATE organization.firmware_units
   SET dispatch_state = 'dispatched', outcome_state = 'unknown', phase = 'unknown'
 WHERE status = 'in_progress';
UPDATE organization.backup_jobs
   SET control_state = CASE
           WHEN status IN ('done', 'failed') THEN 'completed'
           WHEN EXISTS (
               SELECT 1 FROM organization.backup_units u
                WHERE u.job_id = backup_jobs.id AND u.outcome_state = 'unknown'
           ) THEN 'stopped'
           ELSE 'active'
       END;
UPDATE organization.firmware_jobs
   SET control_state = CASE
           WHEN status IN ('done', 'failed') THEN 'completed'
           WHEN EXISTS (
               SELECT 1 FROM organization.firmware_units u
                WHERE u.job_id = firmware_jobs.id AND u.outcome_state = 'unknown'
           ) THEN 'stopped'
           ELSE 'active'
       END;

CREATE FUNCTION organization.fn_backup_job_create_authorized(
    p_tenant_id       VARCHAR,
    p_target          JSONB,
    p_mode            VARCHAR,
    p_created_by      VARCHAR,
    p_idempotency_key VARCHAR,
    p_request_hash    VARCHAR,
    p_authority       JSONB
)
RETURNS TABLE (id TEXT, created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
    existing_id UUID;
    existing_request_hash VARCHAR;
BEGIN
    IF p_authority IS NULL THEN
        RAISE EXCEPTION 'backup job authority is required' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        SELECT j.id, j.request_hash
          INTO existing_id, existing_request_hash
          FROM organization.backup_jobs j
         WHERE j.tenant_id = p_tenant_id
           AND j.idempotency_key = p_idempotency_key
         LIMIT 1;
        IF existing_id IS NOT NULL THEN
            IF existing_request_hash <> p_request_hash THEN
                RAISE EXCEPTION 'idempotency key already used with different backup job payload'
                    USING ERRCODE = '23505';
            END IF;
            RETURN QUERY SELECT existing_id::text, false;
            RETURN;
        END IF;
    END IF;
    RETURN QUERY
    INSERT INTO organization.backup_jobs
        (tenant_id, target_summary, mode, idempotency_key, request_hash,
         status, created_by, authority)
    VALUES
        (p_tenant_id, p_target, p_mode, p_idempotency_key, p_request_hash,
         'queued', p_created_by, p_authority)
    RETURNING backup_jobs.id::text, true;
END;
$$;

CREATE FUNCTION fm.fn_job_prepare_dispatch(
    p_kind VARCHAR, p_unit_id INTEGER, p_execution_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id UUID;
    v_changed INTEGER;
BEGIN
    IF p_kind = 'backup' THEN
        SELECT job_id INTO v_job_id FROM organization.backup_units
         WHERE id = p_unit_id AND execution_id = p_execution_id;
        PERFORM 1 FROM organization.backup_jobs
         WHERE id = v_job_id AND control_state = 'active' FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE organization.backup_units
           SET dispatch_state = 'dispatched'
         WHERE id = p_unit_id AND execution_id = p_execution_id
           AND status = 'in_progress' AND outcome_state = 'active'
           AND dispatch_state = 'claimed';
    ELSIF p_kind = 'firmware' THEN
        SELECT job_id INTO v_job_id FROM organization.firmware_units
         WHERE id = p_unit_id AND execution_id = p_execution_id;
        PERFORM 1 FROM organization.firmware_jobs
         WHERE id = v_job_id AND control_state = 'active' FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE organization.firmware_units
           SET dispatch_state = 'dispatched'
         WHERE id = p_unit_id AND execution_id = p_execution_id
           AND status = 'in_progress' AND outcome_state = 'active'
           AND dispatch_state = 'claimed';
    ELSE
        RETURN false;
    END IF;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed = 1;
END;
$$;

CREATE FUNCTION fm.fn_job_cancel(
    p_kind VARCHAR, p_tenant_id VARCHAR, p_job_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_active INTEGER;
BEGIN
    IF p_kind = 'backup' THEN
        PERFORM 1 FROM organization.backup_jobs
         WHERE id = p_job_id AND tenant_id = p_tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE organization.backup_units SET outcome_state = 'stopped',
               phase = 'stopped', finished_at = now(),
               last_error = 'job_cancelled_before_dispatch'
         WHERE job_id = p_job_id AND outcome_state = 'active'
           AND dispatch_state IN ('queued', 'claimed');
        SELECT count(*) INTO v_active FROM organization.backup_units
         WHERE job_id = p_job_id AND outcome_state = 'active'
           AND status IN ('queued', 'in_progress');
        UPDATE organization.backup_jobs SET
               control_state = CASE WHEN v_active > 0 THEN 'cancel_requested' ELSE 'stopped' END,
               cancel_requested_at = COALESCE(cancel_requested_at, now()),
               finished_at = CASE WHEN v_active = 0 THEN COALESCE(finished_at, now()) ELSE finished_at END
         WHERE id = p_job_id;
    ELSIF p_kind = 'firmware' THEN
        PERFORM 1 FROM organization.firmware_jobs
         WHERE id = p_job_id AND tenant_id = p_tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE organization.firmware_units SET outcome_state = 'stopped',
               phase = 'stopped', finished_at = now(),
               last_error = 'job_cancelled_before_dispatch'
         WHERE job_id = p_job_id AND outcome_state = 'active'
           AND dispatch_state IN ('queued', 'claimed');
        SELECT count(*) INTO v_active FROM organization.firmware_units
         WHERE job_id = p_job_id AND outcome_state = 'active'
           AND status IN ('queued', 'in_progress');
        UPDATE organization.firmware_jobs SET
               control_state = CASE WHEN v_active > 0 THEN 'cancel_requested' ELSE 'stopped' END,
               cancel_requested_at = COALESCE(cancel_requested_at, now()),
               finished_at = CASE WHEN v_active = 0 THEN COALESCE(finished_at, now()) ELSE finished_at END
         WHERE id = p_job_id;
    ELSE
        RETURN false;
    END IF;
    RETURN true;
END;
$$;

CREATE FUNCTION fm.fn_job_resume(
    p_kind VARCHAR, p_tenant_id VARCHAR, p_job_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_changed INTEGER;
BEGIN
    IF p_kind = 'backup' THEN
        PERFORM 1 FROM organization.backup_jobs WHERE id = p_job_id
         AND tenant_id = p_tenant_id AND control_state = 'stopped' FOR UPDATE;
        IF NOT FOUND OR EXISTS (SELECT 1 FROM organization.backup_units
            WHERE job_id = p_job_id AND outcome_state = 'unknown') THEN RETURN false; END IF;
        UPDATE organization.backup_units SET status = 'queued', phase = NULL,
               picked_up_at = NULL, finished_at = NULL, last_error = NULL,
               execution_id = NULL, dispatch_state = 'queued', outcome_state = 'active'
         WHERE job_id = p_job_id AND outcome_state = 'stopped'
           AND dispatch_state <> 'dispatched';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        IF v_changed = 0 THEN RETURN false; END IF;
        UPDATE organization.backup_jobs SET control_state = 'active', status = 'queued',
               finished_at = NULL, cancel_requested_at = NULL WHERE id = p_job_id;
    ELSIF p_kind = 'firmware' THEN
        PERFORM 1 FROM organization.firmware_jobs WHERE id = p_job_id
         AND tenant_id = p_tenant_id AND control_state = 'stopped' FOR UPDATE;
        IF NOT FOUND OR EXISTS (SELECT 1 FROM organization.firmware_units
            WHERE job_id = p_job_id AND outcome_state = 'unknown') THEN RETURN false; END IF;
        UPDATE organization.firmware_units SET status = 'queued', phase = NULL,
               picked_up_at = NULL, finished_at = NULL, last_error = NULL,
               execution_id = NULL, dispatch_state = 'queued', outcome_state = 'active'
         WHERE job_id = p_job_id AND outcome_state = 'stopped'
           AND dispatch_state <> 'dispatched';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        IF v_changed = 0 THEN RETURN false; END IF;
        UPDATE organization.firmware_jobs SET control_state = 'active', status = 'queued',
               finished_at = NULL, cancel_requested_at = NULL WHERE id = p_job_id;
    ELSE
        RETURN false;
    END IF;
    RETURN true;
END;
$$;

CREATE FUNCTION organization.fn_firmware_job_create_authorized(
    p_tenant_id       VARCHAR,
    p_target          JSONB,
    p_mode            VARCHAR,
    p_created_by      VARCHAR,
    p_idempotency_key VARCHAR,
    p_request_hash    VARCHAR,
    p_authority       JSONB
)
RETURNS TABLE (id TEXT, created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
    existing_id UUID;
    existing_request_hash VARCHAR;
BEGIN
    IF p_authority IS NULL THEN
        RAISE EXCEPTION 'firmware job authority is required' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        SELECT j.id, j.request_hash
          INTO existing_id, existing_request_hash
          FROM organization.firmware_jobs j
         WHERE j.tenant_id = p_tenant_id
           AND j.idempotency_key = p_idempotency_key
         LIMIT 1;
        IF existing_id IS NOT NULL THEN
            IF existing_request_hash <> p_request_hash THEN
                RAISE EXCEPTION 'idempotency key already used with different firmware job payload'
                    USING ERRCODE = '23505';
            END IF;
            RETURN QUERY SELECT existing_id::text, false;
            RETURN;
        END IF;
    END IF;
    RETURN QUERY
    INSERT INTO organization.firmware_jobs
        (tenant_id, target_summary, mode, idempotency_key, request_hash,
         status, created_by, authority)
    VALUES
        (p_tenant_id, p_target, p_mode, p_idempotency_key, p_request_hash,
         'queued', p_created_by, p_authority)
    RETURNING firmware_jobs.id::text, true;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_job_resume(VARCHAR, VARCHAR, UUID);
DROP FUNCTION IF EXISTS fm.fn_job_cancel(VARCHAR, VARCHAR, UUID);
DROP FUNCTION IF EXISTS fm.fn_job_prepare_dispatch(VARCHAR, INTEGER, UUID);
DROP FUNCTION IF EXISTS organization.fn_firmware_job_create_authorized(
    VARCHAR, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB
);
DROP FUNCTION IF EXISTS organization.fn_backup_job_create_authorized(
    VARCHAR, JSONB, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB
);

DROP INDEX IF EXISTS organization.firmware_units_control_idx;
DROP INDEX IF EXISTS organization.backup_units_control_idx;

ALTER TABLE organization.firmware_units
    DROP COLUMN IF EXISTS outcome_state,
    DROP COLUMN IF EXISTS dispatch_state,
    DROP COLUMN IF EXISTS execution_id;
ALTER TABLE organization.backup_units
    DROP COLUMN IF EXISTS outcome_state,
    DROP COLUMN IF EXISTS dispatch_state,
    DROP COLUMN IF EXISTS execution_id;
ALTER TABLE organization.firmware_jobs
    DROP COLUMN IF EXISTS authority,
    DROP COLUMN IF EXISTS cancel_requested_at,
    DROP COLUMN IF EXISTS control_state;
ALTER TABLE organization.backup_jobs
    DROP COLUMN IF EXISTS authority,
    DROP COLUMN IF EXISTS cancel_requested_at,
    DROP COLUMN IF EXISTS control_state;
