--------------UP
-- Certificate store: imported + FM-issued X.509 certs, push jobs, and per-device push rows.
-- Plan: docs/plans/2026-05-03-certificate-store.md (DB schema section).

SET search_path TO organization;

CREATE TABLE IF NOT EXISTS certificates (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name                    text NOT NULL,
    kind                    text NOT NULL CHECK (kind IN ('root_ca', 'client_pair', 'server_bundle', 'device', 'other')),
    pem                     text NOT NULL,
    private_key_encrypted   text,
    fingerprint_sha256      varchar(95) NOT NULL,
    subject_cn              text,
    issuer_cn               text,
    sans                    text[],
    key_algo                text,
    chain_depth             int,
    basic_constraints_ca    boolean,
    not_before              timestamptz,
    not_after               timestamptz,
    slot_compat             text[],
    device_compatible       boolean NOT NULL DEFAULT false,
    incompat_reasons        text[],
    source                  text NOT NULL CHECK (source IN ('imported', 'fm-issued')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    created_by              text,
    last_used_at            timestamptz,
    superseded_by           uuid,
    UNIQUE (tenant_id, fingerprint_sha256)
);
CREATE INDEX IF NOT EXISTS certificates_tenant_kind_idx
    ON certificates (tenant_id, kind);
CREATE INDEX IF NOT EXISTS certificates_tenant_not_after_idx
    ON certificates (tenant_id, not_after);
CREATE INDEX IF NOT EXISTS certificates_tenant_source_idx
    ON certificates (tenant_id, source);

CREATE TABLE IF NOT EXISTS certificate_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    certificate_id  uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
    slot            text NOT NULL,
    target_summary  jsonb NOT NULL,
    status          text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    started_at      timestamptz,
    finished_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);
CREATE INDEX IF NOT EXISTS certificate_jobs_tenant_status_idx
    ON certificate_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS certificate_jobs_cert_idx
    ON certificate_jobs (certificate_id);

CREATE TABLE IF NOT EXISTS certificate_pushes (
    id                bigserial PRIMARY KEY,
    job_id            uuid NOT NULL REFERENCES certificate_jobs(id) ON DELETE CASCADE,
    certificate_id    uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
    device_id         text NOT NULL,
    slot              text NOT NULL,
    status            text NOT NULL CHECK (status IN ('queued', 'in_progress', 'applied', 'failed', 'rolled_back')),
    last_error        text,
    applied_at        timestamptz,
    requires_reboot   boolean NOT NULL DEFAULT false,
    retry_count       int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS certificate_pushes_device_slot_idx
    ON certificate_pushes (device_id, slot);
CREATE INDEX IF NOT EXISTS certificate_pushes_cert_idx
    ON certificate_pushes (certificate_id);
CREATE INDEX IF NOT EXISTS certificate_pushes_job_idx
    ON certificate_pushes (job_id);

--------------DOWN
SET search_path TO organization;

DROP TABLE IF EXISTS certificate_pushes;
DROP TABLE IF EXISTS certificate_jobs;
DROP TABLE IF EXISTS certificates;
