--------------UP
-- Defense in depth: the by-job push readers were tenant-blind and relied on the
-- caller checking job ownership first. Add p_tenant_id so a job id from another
-- tenant returns no rows even if the prior status check is ever bypassed.

DROP FUNCTION IF EXISTS organization.fn_certificate_push_rows_by_job(UUID);
CREATE FUNCTION organization.fn_certificate_push_rows_by_job(
    p_job_id    UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (
    id              INT,
    job_id          TEXT,
    certificate_id  TEXT,
    device_id       VARCHAR,
    slot            VARCHAR,
    status          VARCHAR,
    last_error      TEXT,
    applied_at      TIMESTAMPTZ,
    requires_reboot BOOLEAN,
    retry_count     INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.job_id::text, p.certificate_id::text, p.device_id, p.slot,
           p.status, p.last_error, p.applied_at, p.requires_reboot,
           p.retry_count
      FROM organization.certificate_pushes p
      JOIN organization.certificates c ON c.id = p.certificate_id
     WHERE p.job_id = p_job_id
       AND c.tenant_id = p_tenant_id
     ORDER BY p.id ASC;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_push_rows_by_job(UUID);
CREATE FUNCTION organization.fn_credential_push_rows_by_job(
    p_job_id    UUID,
    p_tenant_id VARCHAR
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
       AND tenant_id = p_tenant_id
     ORDER BY id ASC;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_certificate_push_rows_by_job(UUID, VARCHAR);
CREATE FUNCTION organization.fn_certificate_push_rows_by_job(
    p_job_id UUID
)
RETURNS TABLE (
    id              INT,
    job_id          TEXT,
    certificate_id  TEXT,
    device_id       VARCHAR,
    slot            VARCHAR,
    status          VARCHAR,
    last_error      TEXT,
    applied_at      TIMESTAMPTZ,
    requires_reboot BOOLEAN,
    retry_count     INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id, job_id::text, certificate_id::text, device_id, slot,
           status, last_error, applied_at, requires_reboot, retry_count
      FROM organization.certificate_pushes
     WHERE job_id = p_job_id
     ORDER BY id ASC;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_push_rows_by_job(UUID, VARCHAR);
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
