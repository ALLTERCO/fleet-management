--------------UP
SET search_path TO organization;

CREATE TABLE IF NOT EXISTS backup_jobs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      VARCHAR NOT NULL,
    target_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    mode           VARCHAR NOT NULL CHECK (mode IN ('create', 'restore')),
    idempotency_key VARCHAR,
    request_hash   VARCHAR NOT NULL,
    status         VARCHAR NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    created_by     VARCHAR,
    last_error     TEXT
);

CREATE INDEX IF NOT EXISTS backup_jobs_tenant_status_idx
    ON backup_jobs (tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS backup_jobs_tenant_idempotency_key_idx
    ON backup_jobs (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS backup_units (
    id           SERIAL PRIMARY KEY,
    job_id       UUID NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
    tenant_id    VARCHAR NOT NULL,
    device_id    VARCHAR NOT NULL,
    backup_id    VARCHAR,
    status       VARCHAR NOT NULL CHECK (status IN ('queued', 'in_progress', 'done', 'failed')),
    phase        VARCHAR,
    last_error   TEXT,
    result       JSONB,
    picked_up_at TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS backup_units_job_idx
    ON backup_units (job_id);

CREATE INDEX IF NOT EXISTS backup_units_status_idx
    ON backup_units (status, id)
    WHERE status IN ('queued', 'in_progress');

CREATE INDEX IF NOT EXISTS backup_units_tenant_device_idx
    ON backup_units (tenant_id, device_id);

CREATE TABLE IF NOT EXISTS firmware_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR NOT NULL,
    target_summary  JSONB NOT NULL DEFAULT '{}'::jsonb,
    mode            VARCHAR NOT NULL CHECK (mode IN ('channel', 'url')),
    idempotency_key VARCHAR,
    request_hash    VARCHAR NOT NULL,
    status          VARCHAR NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_by      VARCHAR,
    last_error      TEXT
);

CREATE INDEX IF NOT EXISTS firmware_jobs_tenant_status_idx
    ON firmware_jobs (tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS firmware_jobs_tenant_idempotency_key_idx
    ON firmware_jobs (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS firmware_units (
    id               SERIAL PRIMARY KEY,
    job_id           UUID NOT NULL REFERENCES firmware_jobs(id) ON DELETE CASCADE,
    tenant_id        VARCHAR NOT NULL,
    device_id        VARCHAR NOT NULL,
    request          JSONB NOT NULL DEFAULT '{}'::jsonb,
    status           VARCHAR NOT NULL CHECK (status IN ('queued', 'in_progress', 'done', 'failed')),
    phase            VARCHAR,
    progress_percent INTEGER,
    previous_version VARCHAR,
    previous_fw_id   VARCHAR,
    final_version    VARCHAR,
    final_fw_id      VARCHAR,
    last_error       TEXT,
    result           JSONB,
    picked_up_at     TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS firmware_units_job_idx
    ON firmware_units (job_id);

CREATE INDEX IF NOT EXISTS firmware_units_status_idx
    ON firmware_units (status, id)
    WHERE status IN ('queued', 'in_progress');

CREATE INDEX IF NOT EXISTS firmware_units_tenant_device_idx
    ON firmware_units (tenant_id, device_id);

CREATE FUNCTION organization.fn_backup_job_create(
    p_tenant_id       VARCHAR,
    p_target          JSONB,
    p_mode            VARCHAR,
    p_created_by      VARCHAR,
    p_idempotency_key VARCHAR,
    p_request_hash    VARCHAR
)
RETURNS TABLE (id TEXT, created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
    existing_id UUID;
    existing_request_hash VARCHAR;
BEGIN
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
        (tenant_id, target_summary, mode, idempotency_key, request_hash, status, created_by)
    VALUES (p_tenant_id, p_target, p_mode, p_idempotency_key, p_request_hash, 'queued', p_created_by)
    RETURNING backup_jobs.id::text, true;
END;
$$;

CREATE FUNCTION organization.fn_backup_unit_enqueue_batch(
    p_job_id     UUID,
    p_tenant_id  VARCHAR,
    p_device_ids VARCHAR[]
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO organization.backup_units
        (job_id, tenant_id, device_id, status)
    SELECT p_job_id, p_tenant_id, unnest(p_device_ids), 'queued';
$$;

CREATE FUNCTION organization.fn_firmware_job_create(
    p_tenant_id       VARCHAR,
    p_target          JSONB,
    p_mode            VARCHAR,
    p_created_by      VARCHAR,
    p_idempotency_key VARCHAR,
    p_request_hash    VARCHAR
)
RETURNS TABLE (id TEXT, created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
    existing_id UUID;
    existing_request_hash VARCHAR;
BEGIN
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
        (tenant_id, target_summary, mode, idempotency_key, request_hash, status, created_by)
    VALUES (p_tenant_id, p_target, p_mode, p_idempotency_key, p_request_hash, 'queued', p_created_by)
    RETURNING firmware_jobs.id::text, true;
END;
$$;

CREATE FUNCTION organization.fn_firmware_unit_enqueue_batch(
    p_job_id     UUID,
    p_tenant_id  VARCHAR,
    p_device_ids VARCHAR[],
    p_request    JSONB
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO organization.firmware_units
        (job_id, tenant_id, device_id, request, status)
    SELECT p_job_id, p_tenant_id, unnest(p_device_ids), p_request, 'queued';
$$;

--------------DOWN
SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_firmware_unit_enqueue_batch;
DROP FUNCTION IF EXISTS organization.fn_firmware_job_create;
DROP FUNCTION IF EXISTS organization.fn_backup_unit_enqueue_batch;
DROP FUNCTION IF EXISTS organization.fn_backup_job_create;
DROP TABLE IF EXISTS firmware_units;
DROP TABLE IF EXISTS firmware_jobs;
DROP TABLE IF EXISTS backup_units;
DROP TABLE IF EXISTS backup_jobs;
