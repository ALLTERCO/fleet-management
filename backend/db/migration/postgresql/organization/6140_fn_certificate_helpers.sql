--------------UP
-- CertificateComponent raw-SQL → fn_*. Per Ref P, service layer never
-- touches raw SQL. The "list/list_pushes" filter sets are passed as
-- nullable params so callers no longer build dynamic WHERE clauses.

CREATE FUNCTION organization.fn_certificate_list(
    p_tenant_id            VARCHAR,
    p_kind                 VARCHAR,
    p_source               VARCHAR,
    p_slot                 VARCHAR,
    p_expiring_within_days INT,
    p_limit                INT,
    p_offset               INT
)
RETURNS TABLE (
    id                    TEXT,
    tenant_id             TEXT,
    name                  VARCHAR,
    kind                  VARCHAR,
    fingerprint_sha256    VARCHAR,
    subject_cn            VARCHAR,
    issuer_cn             VARCHAR,
    sans                  TEXT[],
    key_algo              VARCHAR,
    chain_depth           INT,
    basic_constraints_ca  BOOLEAN,
    not_before            TIMESTAMPTZ,
    not_after             TIMESTAMPTZ,
    slot_compat           TEXT[],
    device_compatible     BOOLEAN,
    incompat_reasons      TEXT[],
    source                VARCHAR,
    created_at            TIMESTAMPTZ,
    created_by            TEXT,
    last_used_at          TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, name, kind, fingerprint_sha256,
           subject_cn, issuer_cn, sans, key_algo, chain_depth,
           basic_constraints_ca, not_before, not_after, slot_compat,
           device_compatible, incompat_reasons, source, created_at,
           created_by::text, last_used_at
      FROM organization.certificates
     WHERE tenant_id = p_tenant_id
       AND (p_kind   IS NULL OR kind   = p_kind)
       AND (p_source IS NULL OR source = p_source)
       AND (p_slot   IS NULL OR p_slot = ANY(slot_compat))
       AND (p_expiring_within_days IS NULL
            OR (not_after IS NOT NULL
                AND not_after <= now() + make_interval(days => p_expiring_within_days)))
     ORDER BY created_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE FUNCTION organization.fn_certificate_get(
    p_id          UUID,
    p_tenant_id   VARCHAR,
    p_include_pem BOOLEAN
)
RETURNS TABLE (
    id                    TEXT,
    tenant_id             TEXT,
    name                  VARCHAR,
    kind                  VARCHAR,
    fingerprint_sha256    VARCHAR,
    subject_cn            VARCHAR,
    issuer_cn             VARCHAR,
    sans                  TEXT[],
    key_algo              VARCHAR,
    chain_depth           INT,
    basic_constraints_ca  BOOLEAN,
    not_before            TIMESTAMPTZ,
    not_after             TIMESTAMPTZ,
    slot_compat           TEXT[],
    device_compatible     BOOLEAN,
    incompat_reasons      TEXT[],
    source                VARCHAR,
    created_at            TIMESTAMPTZ,
    created_by            TEXT,
    last_used_at          TIMESTAMPTZ,
    pem                   TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, name, kind, fingerprint_sha256,
           subject_cn, issuer_cn, sans, key_algo, chain_depth,
           basic_constraints_ca, not_before, not_after, slot_compat,
           device_compatible, incompat_reasons, source, created_at,
           created_by::text, last_used_at,
           CASE WHEN p_include_pem THEN pem ELSE NULL END
      FROM organization.certificates
     WHERE id = p_id AND tenant_id = p_tenant_id;
$$;

-- Upsert by (tenant_id, fingerprint_sha256). xmax<>0 signals an existing
-- row was reused (caller surfaces was_existing back to the user).
CREATE FUNCTION organization.fn_certificate_import(
    p_tenant_id             VARCHAR,
    p_name                  VARCHAR,
    p_kind                  VARCHAR,
    p_pem                   TEXT,
    p_private_key_encrypted TEXT,
    p_fingerprint_sha256    VARCHAR,
    p_subject_cn            VARCHAR,
    p_issuer_cn             VARCHAR,
    p_sans                  TEXT[],
    p_key_algo              VARCHAR,
    p_chain_depth           INT,
    p_basic_constraints_ca  BOOLEAN,
    p_not_before            TIMESTAMPTZ,
    p_not_after             TIMESTAMPTZ,
    p_slot_compat           TEXT[],
    p_device_compatible     BOOLEAN,
    p_incompat_reasons      TEXT[],
    p_source                VARCHAR,
    p_created_by            VARCHAR
)
RETURNS TABLE (
    id                    TEXT,
    tenant_id             TEXT,
    name                  VARCHAR,
    kind                  VARCHAR,
    fingerprint_sha256    VARCHAR,
    subject_cn            VARCHAR,
    issuer_cn             VARCHAR,
    sans                  TEXT[],
    key_algo              VARCHAR,
    chain_depth           INT,
    basic_constraints_ca  BOOLEAN,
    not_before            TIMESTAMPTZ,
    not_after             TIMESTAMPTZ,
    slot_compat           TEXT[],
    device_compatible     BOOLEAN,
    incompat_reasons      TEXT[],
    source                VARCHAR,
    created_at            TIMESTAMPTZ,
    created_by            TEXT,
    last_used_at          TIMESTAMPTZ,
    was_existing          BOOLEAN
)
LANGUAGE sql
AS $$
    INSERT INTO organization.certificates
        (tenant_id, name, kind, pem, private_key_encrypted,
         fingerprint_sha256, subject_cn, issuer_cn, sans,
         key_algo, chain_depth, basic_constraints_ca,
         not_before, not_after,
         slot_compat, device_compatible, incompat_reasons,
         source, created_by)
    VALUES
        (p_tenant_id, p_name, p_kind, p_pem, p_private_key_encrypted,
         p_fingerprint_sha256, p_subject_cn, p_issuer_cn, p_sans,
         p_key_algo, p_chain_depth, p_basic_constraints_ca,
         p_not_before, p_not_after,
         p_slot_compat, p_device_compatible, p_incompat_reasons,
         p_source, p_created_by)
    ON CONFLICT (tenant_id, fingerprint_sha256) DO UPDATE
        SET name = EXCLUDED.name
    RETURNING id::text, tenant_id::text, name, kind, fingerprint_sha256,
              subject_cn, issuer_cn, sans, key_algo, chain_depth,
              basic_constraints_ca, not_before, not_after, slot_compat,
              device_compatible, incompat_reasons, source, created_at,
              created_by::text, last_used_at, (xmax <> 0);
$$;

CREATE FUNCTION organization.fn_certificate_update_name(
    p_id        UUID,
    p_tenant_id VARCHAR,
    p_name      VARCHAR
)
RETURNS TABLE (
    id                    TEXT,
    tenant_id             TEXT,
    name                  VARCHAR,
    kind                  VARCHAR,
    fingerprint_sha256    VARCHAR,
    subject_cn            VARCHAR,
    issuer_cn             VARCHAR,
    sans                  TEXT[],
    key_algo              VARCHAR,
    chain_depth           INT,
    basic_constraints_ca  BOOLEAN,
    not_before            TIMESTAMPTZ,
    not_after             TIMESTAMPTZ,
    slot_compat           TEXT[],
    device_compatible     BOOLEAN,
    incompat_reasons      TEXT[],
    source                VARCHAR,
    created_at            TIMESTAMPTZ,
    created_by            TEXT,
    last_used_at          TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE organization.certificates
       SET name = p_name
     WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING id::text, tenant_id::text, name, kind, fingerprint_sha256,
              subject_cn, issuer_cn, sans, key_algo, chain_depth,
              basic_constraints_ca, not_before, not_after, slot_compat,
              device_compatible, incompat_reasons, source, created_at,
              created_by::text, last_used_at;
$$;

-- Atomic delete: rejects when any push is still the active one for some
-- (device, slot). Returns (live_count, deleted_count).
CREATE FUNCTION organization.fn_certificate_delete_safe(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (live_count INT, deleted_count INT)
LANGUAGE sql
AS $$
    WITH live AS (
        SELECT 1 AS marker
          FROM organization.certificate_pushes cp
         WHERE cp.certificate_id = p_id
           AND cp.status = 'applied'
           AND NOT EXISTS (
               SELECT 1 FROM organization.certificate_pushes p2
                WHERE p2.device_id = cp.device_id
                  AND p2.slot = cp.slot
                  AND p2.status = 'applied'
                  AND p2.applied_at > cp.applied_at
           )
         LIMIT 1
    ),
    deleted AS (
        DELETE FROM organization.certificates
         WHERE id = p_id
           AND tenant_id = p_tenant_id
           AND NOT EXISTS (SELECT 1 FROM live)
        RETURNING id
    )
    SELECT (SELECT count(*)::int FROM live),
           (SELECT count(*)::int FROM deleted);
$$;

CREATE FUNCTION organization.fn_certificate_export_row(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (
    id                    TEXT,
    name                  VARCHAR,
    pem                   TEXT,
    private_key_encrypted TEXT,
    source                VARCHAR,
    fingerprint_sha256    VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, name, pem, private_key_encrypted, source, fingerprint_sha256
      FROM organization.certificates
     WHERE id = p_id AND tenant_id = p_tenant_id;
$$;

CREATE FUNCTION organization.fn_certificate_get_preflight(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (slot_compat TEXT[], key_algo VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT slot_compat, key_algo
      FROM organization.certificates
     WHERE id = p_id AND tenant_id = p_tenant_id;
$$;

CREATE FUNCTION organization.fn_certificate_get_slot_compat(
    p_id        UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (id TEXT, slot_compat TEXT[])
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, slot_compat
      FROM organization.certificates
     WHERE id = p_id AND tenant_id = p_tenant_id;
$$;

CREATE FUNCTION organization.fn_certificate_job_create(
    p_tenant_id      VARCHAR,
    p_certificate_id UUID,
    p_slot           VARCHAR,
    p_target         JSONB,
    p_created_by     VARCHAR
)
RETURNS TABLE (id TEXT)
LANGUAGE sql
AS $$
    INSERT INTO organization.certificate_jobs
        (tenant_id, certificate_id, slot, target_summary, status, started_at, created_by)
    VALUES
        (p_tenant_id, p_certificate_id, p_slot, p_target, 'queued', now(), p_created_by)
    RETURNING id::text;
$$;

-- One queued certificate_pushes row per target device, all from a single
-- INSERT.  p_device_ids carries the unnest()-able device list.
CREATE FUNCTION organization.fn_certificate_push_enqueue_batch(
    p_job_id         UUID,
    p_tenant_id      VARCHAR,
    p_certificate_id UUID,
    p_slot           VARCHAR,
    p_device_ids     VARCHAR[]
)
RETURNS INT
LANGUAGE sql
AS $$
    WITH ins AS (
        INSERT INTO organization.certificate_pushes
            (job_id, tenant_id, certificate_id, device_id, slot, status)
        SELECT p_job_id, p_tenant_id, p_certificate_id, d, p_slot, 'queued'
          FROM unnest(p_device_ids) AS t(d)
        RETURNING 1
    )
    SELECT count(*)::int FROM ins;
$$;

CREATE FUNCTION organization.fn_certificate_job_status(
    p_job_id    UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (
    id              TEXT,
    tenant_id       TEXT,
    certificate_id  TEXT,
    slot            VARCHAR,
    target_summary  JSONB,
    status          VARCHAR,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ,
    created_by      TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, certificate_id::text, slot,
           target_summary, status, started_at, finished_at,
           created_at, created_by::text
      FROM organization.certificate_jobs
     WHERE id = p_job_id AND tenant_id = p_tenant_id;
$$;

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

CREATE FUNCTION organization.fn_certificate_list_pushes(
    p_tenant_id      VARCHAR,
    p_certificate_id UUID,
    p_device_id      VARCHAR,
    p_job_id         UUID,
    p_limit          INT,
    p_offset         INT
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
    SELECT p.id, p.job_id::text, p.certificate_id::text, p.device_id,
           p.slot, p.status, p.last_error, p.applied_at,
           p.requires_reboot, p.retry_count
      FROM organization.certificate_pushes p
      JOIN organization.certificates c ON c.id = p.certificate_id
     WHERE c.tenant_id = p_tenant_id
       AND (p_certificate_id IS NULL OR p.certificate_id = p_certificate_id)
       AND (p_device_id      IS NULL OR p.device_id      = p_device_id)
       AND (p_job_id         IS NULL OR p.job_id         = p_job_id)
     ORDER BY p.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

--------------DOWN
DROP FUNCTION organization.fn_certificate_list_pushes;
DROP FUNCTION organization.fn_certificate_push_rows_by_job;
DROP FUNCTION organization.fn_certificate_job_status;
DROP FUNCTION organization.fn_certificate_push_enqueue_batch;
DROP FUNCTION organization.fn_certificate_job_create;
DROP FUNCTION organization.fn_certificate_get_slot_compat;
DROP FUNCTION organization.fn_certificate_get_preflight;
DROP FUNCTION organization.fn_certificate_export_row;
DROP FUNCTION organization.fn_certificate_delete_safe;
DROP FUNCTION organization.fn_certificate_update_name;
DROP FUNCTION organization.fn_certificate_import;
DROP FUNCTION organization.fn_certificate_get;
DROP FUNCTION organization.fn_certificate_list;
