--------------UP
ALTER TABLE organization.certificate_jobs
    ADD COLUMN IF NOT EXISTS control_state VARCHAR NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS authority JSONB;

ALTER TABLE organization.credential_jobs
    ADD COLUMN IF NOT EXISTS control_state VARCHAR NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS authority JSONB;

ALTER TABLE organization.certificate_pushes
    ADD COLUMN IF NOT EXISTS execution_id UUID,
    ADD COLUMN IF NOT EXISTS dispatch_state VARCHAR NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS outcome_state VARCHAR NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

ALTER TABLE organization.credential_pushes
    ADD COLUMN IF NOT EXISTS execution_id UUID,
    ADD COLUMN IF NOT EXISTS dispatch_state VARCHAR NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS outcome_state VARCHAR NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS certificate_pushes_control_idx
    ON organization.certificate_pushes (job_id, outcome_state, dispatch_state);
CREATE INDEX IF NOT EXISTS credential_pushes_control_idx
    ON organization.credential_pushes (job_id, outcome_state, dispatch_state);

UPDATE organization.certificate_pushes
   SET dispatch_state='dispatched', outcome_state='unknown'
 WHERE status='in_progress'
   AND execution_id IS NULL
   AND dispatch_state='queued'
   AND outcome_state='active';
UPDATE organization.credential_pushes
   SET dispatch_state='dispatched', outcome_state='unknown', status='unknown'
 WHERE status='in_progress'
   AND execution_id IS NULL
   AND dispatch_state='queued'
   AND outcome_state='active';
UPDATE organization.certificate_pushes push
   SET outcome_state='stopped', last_error='legacy_job_has_no_persistent_authority', finished_at=now()
  FROM organization.certificate_jobs job
 WHERE push.job_id=job.id AND job.authority IS NULL AND push.outcome_state='active';
UPDATE organization.credential_pushes push
   SET outcome_state='stopped', last_error='legacy_job_has_no_persistent_authority', finished_at=now()
  FROM organization.credential_jobs job
 WHERE push.job_id=job.id AND job.authority IS NULL AND push.outcome_state='active';
UPDATE organization.certificate_jobs job
   SET control_state = CASE WHEN job.status IN ('done','failed') THEN 'completed'
       WHEN EXISTS (SELECT 1 FROM organization.certificate_pushes push
                     WHERE push.job_id=job.id AND push.outcome_state='unknown') THEN 'stopped'
       WHEN job.authority IS NULL THEN 'stopped' ELSE 'active' END
 WHERE job.control_state='active';
UPDATE organization.credential_jobs job
   SET control_state = CASE WHEN job.status IN ('done','failed') THEN 'completed'
       WHEN EXISTS (SELECT 1 FROM organization.credential_pushes push
                     WHERE push.job_id=job.id AND push.outcome_state='unknown') THEN 'stopped'
       WHEN job.authority IS NULL THEN 'stopped' ELSE 'active' END
 WHERE job.control_state='active';

CREATE OR REPLACE FUNCTION organization.fn_certificate_job_create_authorized(
    p_tenant_id VARCHAR, p_certificate_id UUID, p_slot VARCHAR,
    p_target JSONB, p_created_by VARCHAR, p_authority JSONB
)
RETURNS TABLE (id TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_authority IS NULL THEN
        RAISE EXCEPTION 'certificate job authority is required' USING ERRCODE='22023';
    END IF;
    RETURN QUERY INSERT INTO organization.certificate_jobs
        (tenant_id, certificate_id, slot, target_summary, status, created_by, authority)
    VALUES (p_tenant_id, p_certificate_id, p_slot, p_target, 'queued', p_created_by, p_authority)
    RETURNING certificate_jobs.id::text;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_job_create_authorized(
    p_tenant_id VARCHAR, p_target JSONB, p_mode VARCHAR,
    p_created_by VARCHAR, p_authority JSONB
)
RETURNS TABLE (id TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_authority IS NULL THEN
        RAISE EXCEPTION 'credential job authority is required' USING ERRCODE='22023';
    END IF;
    RETURN QUERY INSERT INTO organization.credential_jobs
        (tenant_id, target_summary, mode, status, created_by, authority)
    VALUES (p_tenant_id, p_target, p_mode, 'queued', p_created_by, p_authority)
    RETURNING credential_jobs.id::text;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_extended_job_prepare_dispatch(
    p_kind VARCHAR, p_unit_id INTEGER, p_execution_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_job_id UUID; v_changed INTEGER;
BEGIN
    IF p_kind='certificate' THEN
        SELECT job_id INTO v_job_id FROM organization.certificate_pushes WHERE id=p_unit_id AND execution_id=p_execution_id;
        PERFORM 1 FROM organization.certificate_jobs WHERE id=v_job_id AND control_state='active' FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE organization.certificate_pushes SET dispatch_state='dispatched'
         WHERE id=p_unit_id AND execution_id=p_execution_id AND status='in_progress'
           AND outcome_state='active' AND dispatch_state='claimed';
    ELSIF p_kind='credential' THEN
        SELECT job_id INTO v_job_id FROM organization.credential_pushes WHERE id=p_unit_id AND execution_id=p_execution_id;
        PERFORM 1 FROM organization.credential_jobs WHERE id=v_job_id AND control_state='active' FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE organization.credential_pushes SET dispatch_state='dispatched'
         WHERE id=p_unit_id AND execution_id=p_execution_id AND status='in_progress'
           AND outcome_state='active' AND dispatch_state='claimed';
    ELSE RETURN false;
    END IF;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    RETURN v_changed=1;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_extended_job_cancel(p_kind VARCHAR, p_tenant_id VARCHAR, p_job_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_active INTEGER; v_locked INTEGER; v_job_table TEXT; v_unit_table TEXT; v_phase TEXT;
BEGIN
    CASE p_kind
        WHEN 'certificate' THEN v_job_table='certificate_jobs'; v_unit_table='certificate_pushes'; v_phase='';
        WHEN 'credential' THEN v_job_table='credential_jobs'; v_unit_table='credential_pushes'; v_phase='';
        ELSE RETURN false;
    END CASE;
    EXECUTE format('SELECT 1 FROM organization.%I WHERE id=$1 AND tenant_id=$2 FOR UPDATE',v_job_table)
       INTO v_locked USING p_job_id,p_tenant_id;
    IF v_locked IS NULL THEN RETURN false; END IF;
    EXECUTE format('UPDATE organization.%I SET outcome_state=''stopped'' %s, finished_at=now(), last_error=''job_cancelled_before_dispatch'' WHERE job_id=$1 AND outcome_state=''active'' AND dispatch_state IN (''queued'',''claimed'')',v_unit_table,v_phase) USING p_job_id;
    EXECUTE format('SELECT count(*) FROM organization.%I WHERE job_id=$1 AND outcome_state=''active'' AND status IN (''queued'',''in_progress'')',v_unit_table) INTO v_active USING p_job_id;
    EXECUTE format('UPDATE organization.%I SET control_state=CASE WHEN $1>0 THEN ''cancel_requested'' ELSE ''stopped'' END, cancel_requested_at=COALESCE(cancel_requested_at,now()), finished_at=CASE WHEN $1=0 THEN COALESCE(finished_at,now()) ELSE finished_at END WHERE id=$2',v_job_table) USING v_active,p_job_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_extended_job_resume(p_kind VARCHAR, p_tenant_id VARCHAR, p_job_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_changed INTEGER; v_locked INTEGER; v_unknown INTEGER; v_job_table TEXT; v_unit_table TEXT; v_phase TEXT;
BEGIN
    CASE p_kind
        WHEN 'certificate' THEN v_job_table='certificate_jobs'; v_unit_table='certificate_pushes'; v_phase=', picked_up_at=NULL';
        WHEN 'credential' THEN v_job_table='credential_jobs'; v_unit_table='credential_pushes'; v_phase=', picked_up_at=NULL';
        ELSE RETURN false;
    END CASE;
    EXECUTE format('SELECT 1 FROM organization.%I WHERE id=$1 AND tenant_id=$2 AND control_state=''stopped'' FOR UPDATE',v_job_table)
       INTO v_locked USING p_job_id,p_tenant_id;
    IF v_locked IS NULL THEN RETURN false; END IF;
    EXECUTE format('SELECT 1 FROM organization.%I WHERE job_id=$1 AND outcome_state=''unknown'' LIMIT 1',v_unit_table)
       INTO v_unknown USING p_job_id;
    IF v_unknown IS NOT NULL THEN RETURN false; END IF;
    EXECUTE format('UPDATE organization.%I SET status=''queued'' %s, finished_at=NULL, last_error=NULL, execution_id=NULL, dispatch_state=''queued'', outcome_state=''active'' WHERE job_id=$1 AND outcome_state=''stopped'' AND dispatch_state<>''dispatched''',v_unit_table,v_phase) USING p_job_id;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed=0 THEN RETURN false; END IF;
    EXECUTE format('UPDATE organization.%I SET control_state=''active'', status=''queued'', finished_at=NULL, cancel_requested_at=NULL WHERE id=$1',v_job_table) USING p_job_id;
    RETURN true;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_extended_job_resume(VARCHAR, VARCHAR, UUID);
DROP FUNCTION IF EXISTS fm.fn_extended_job_cancel(VARCHAR, VARCHAR, UUID);
DROP FUNCTION IF EXISTS fm.fn_extended_job_prepare_dispatch(VARCHAR, INTEGER, UUID);
DROP FUNCTION IF EXISTS organization.fn_credential_job_create_authorized(VARCHAR, JSONB, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS organization.fn_certificate_job_create_authorized(VARCHAR, UUID, VARCHAR, JSONB, VARCHAR, JSONB);
DROP INDEX IF EXISTS organization.credential_pushes_control_idx;
DROP INDEX IF EXISTS organization.certificate_pushes_control_idx;
ALTER TABLE organization.credential_pushes DROP COLUMN IF EXISTS finished_at, DROP COLUMN IF EXISTS outcome_state, DROP COLUMN IF EXISTS dispatch_state, DROP COLUMN IF EXISTS execution_id;
ALTER TABLE organization.certificate_pushes DROP COLUMN IF EXISTS finished_at, DROP COLUMN IF EXISTS outcome_state, DROP COLUMN IF EXISTS dispatch_state, DROP COLUMN IF EXISTS execution_id;
ALTER TABLE organization.credential_jobs DROP COLUMN IF EXISTS authority, DROP COLUMN IF EXISTS cancel_requested_at, DROP COLUMN IF EXISTS control_state;
ALTER TABLE organization.certificate_jobs DROP COLUMN IF EXISTS authority, DROP COLUMN IF EXISTS cancel_requested_at, DROP COLUMN IF EXISTS control_state;
