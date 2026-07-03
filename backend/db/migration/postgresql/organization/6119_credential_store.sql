--------------UP
-- Credential store: per-device admin password (digest), rotation jobs, push rows.
-- Plan: docs/plans/2026-05-03-certificate-store.md (Credential Store sibling).

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS device_credentials (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    device_id                text NOT NULL,
    username                 text NOT NULL DEFAULT 'admin',
    realm                    text NOT NULL,
    password_encrypted       text NOT NULL,
    ha1_hex                  text NOT NULL,
    rotated_at               timestamptz NOT NULL DEFAULT now(),
    rotated_by               text,
    last_rotation_status     text NOT NULL DEFAULT 'ok' CHECK (last_rotation_status IN ('ok', 'failed', 'unknown')),
    last_rotation_error      text,
    UNIQUE (tenant_id, device_id)
);
CREATE INDEX IF NOT EXISTS device_credentials_tenant_idx
    ON device_credentials (tenant_id);
CREATE INDEX IF NOT EXISTS device_credentials_status_idx
    ON device_credentials (tenant_id, last_rotation_status)
 WHERE last_rotation_status <> 'ok';

CREATE TABLE IF NOT EXISTS credential_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    target_summary  jsonb NOT NULL,
    mode            text NOT NULL CHECK (mode IN ('rotate', 'set', 'clear')),
    status          text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    started_at      timestamptz,
    finished_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);
CREATE INDEX IF NOT EXISTS credential_jobs_tenant_status_idx
    ON credential_jobs (tenant_id, status);

CREATE TABLE IF NOT EXISTS credential_pushes (
    id              bigserial PRIMARY KEY,
    job_id          uuid NOT NULL REFERENCES credential_jobs(id) ON DELETE CASCADE,
    device_id       text NOT NULL,
    status          text NOT NULL CHECK (status IN ('queued', 'in_progress', 'ok', 'failed', 'unknown')),
    last_error      text,
    applied_at      timestamptz,
    retry_count     int NOT NULL DEFAULT 0,
    -- Both ha1s retained on failed push for retry / confirm_old recovery.
    ha1_old_hex     text,
    ha1_new_hex     text
);
CREATE INDEX IF NOT EXISTS credential_pushes_job_idx
    ON credential_pushes (job_id);
CREATE INDEX IF NOT EXISTS credential_pushes_status_idx
    ON credential_pushes (status)
 WHERE status IN ('failed', 'unknown');

-- Reveal-on-demand audit: rate-limited per admin per day.
CREATE TABLE IF NOT EXISTS credential_reveal_audit (
    id          bigserial PRIMARY KEY,
    tenant_id   VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    actor_id    text NOT NULL,
    device_id   text NOT NULL,
    revealed_at timestamptz NOT NULL DEFAULT now(),
    justification text
);
CREATE INDEX IF NOT EXISTS credential_reveal_audit_actor_day_idx
    ON credential_reveal_audit (tenant_id, actor_id, revealed_at);

--------------DOWN
SET search_path TO organization;

DROP TABLE IF EXISTS credential_reveal_audit;
DROP TABLE IF EXISTS credential_pushes;
DROP TABLE IF EXISTS credential_jobs;
DROP TABLE IF EXISTS device_credentials;
