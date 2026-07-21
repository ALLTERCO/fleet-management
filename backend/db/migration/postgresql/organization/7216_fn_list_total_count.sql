--------------UP
-- The credential/certificate list fns returned only the page, so callers
-- passed the page size as the envelope total and has_more was always false.
-- Emit the windowed match count on every row (totalFromRows convention).

DROP FUNCTION IF EXISTS organization.fn_credential_list(
    VARCHAR, VARCHAR, VARCHAR, INT, INT
);

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
    last_rotation_error  TEXT,
    total_count          INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, device_id, username, realm,
           rotated_at, rotated_by, last_rotation_status, last_rotation_error,
           COUNT(*) OVER()::int AS total_count
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id
       AND (p_device_id IS NULL OR device_id = p_device_id)
       AND (p_status    IS NULL OR last_rotation_status = p_status)
     ORDER BY rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_list_failed(
    VARCHAR, INT, INT
);

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
    last_rotation_error  TEXT,
    total_count          INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, device_id, username, realm,
           rotated_at, rotated_by, last_rotation_status, last_rotation_error,
           COUNT(*) OVER()::int AS total_count
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id AND last_rotation_status <> 'ok'
     ORDER BY rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_list_pushes(
    VARCHAR, VARCHAR, UUID, VARCHAR, INT, INT
);

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
    requested_by  VARCHAR,
    total_count   INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.job_id::text, p.device_id, p.status, p.last_error,
           p.applied_at, p.picked_up_at, p.retry_count, p.requested_by,
           COUNT(*) OVER()::int AS total_count
      FROM organization.credential_pushes p
     WHERE p.tenant_id = p_tenant_id
       AND (p_device_id IS NULL OR p.device_id = p_device_id)
       AND (p_job_id    IS NULL OR p.job_id    = p_job_id)
       AND (p_status    IS NULL OR p.status    = p_status)
     ORDER BY p.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

DROP FUNCTION IF EXISTS organization.fn_certificate_list(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT, INT
);

CREATE FUNCTION organization.fn_certificate_list(
    p_tenant_id            VARCHAR,
    p_kind                 VARCHAR,
    p_source               VARCHAR,
    p_slot                 VARCHAR,
    p_tag                  VARCHAR,
    p_group_id             INT,
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
    last_used_at          TIMESTAMPTZ,
    metadata              JSONB,
    tags                  TEXT[],
    device_group_ids      INT[],
    total_count           INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, c.name, c.kind, c.fingerprint_sha256,
           c.subject_cn, c.issuer_cn, c.sans, c.key_algo, c.chain_depth,
           c.basic_constraints_ca, c.not_before, c.not_after, c.slot_compat,
           c.device_compatible, c.incompat_reasons, c.source, c.created_at,
           c.created_by::text, c.last_used_at, c.metadata, c.tags,
           COALESCE(
               (SELECT array_agg(cdg.group_id ORDER BY cdg.group_id)
                  FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id),
               ARRAY[]::int[]
           ) AS device_group_ids,
           COUNT(*) OVER()::int AS total_count
      FROM organization.certificates c
     WHERE c.tenant_id = p_tenant_id
       AND (p_kind   IS NULL OR c.kind   = p_kind)
       AND (p_source IS NULL OR c.source = p_source)
       AND (p_slot   IS NULL OR p_slot = ANY(c.slot_compat))
       AND (p_tag    IS NULL OR p_tag  = ANY(c.tags))
       AND (p_group_id IS NULL OR EXISTS (
                SELECT 1 FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id
                   AND cdg.group_id = p_group_id))
       AND (p_expiring_within_days IS NULL
            OR (c.not_after IS NOT NULL
                AND c.not_after <= now() + make_interval(days => p_expiring_within_days)))
     ORDER BY c.created_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

DROP FUNCTION IF EXISTS organization.fn_certificate_list_pushes(
    VARCHAR, UUID, VARCHAR, UUID, INT, INT
);

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
    retry_count     INT,
    total_count     INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.job_id::text, p.certificate_id::text, p.device_id,
           p.slot, p.status, p.last_error, p.applied_at,
           p.requires_reboot, p.retry_count,
           COUNT(*) OVER()::int AS total_count
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
-- Restore the pre-total_count definitions (6141, 6160, 6140).

DROP FUNCTION IF EXISTS organization.fn_credential_list(
    VARCHAR, VARCHAR, VARCHAR, INT, INT
);

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

DROP FUNCTION IF EXISTS organization.fn_credential_list_failed(
    VARCHAR, INT, INT
);

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

DROP FUNCTION IF EXISTS organization.fn_credential_list_pushes(
    VARCHAR, VARCHAR, UUID, VARCHAR, INT, INT
);

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

DROP FUNCTION IF EXISTS organization.fn_certificate_list(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT, INT
);

CREATE FUNCTION organization.fn_certificate_list(
    p_tenant_id            VARCHAR,
    p_kind                 VARCHAR,
    p_source               VARCHAR,
    p_slot                 VARCHAR,
    p_tag                  VARCHAR,
    p_group_id             INT,
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
    last_used_at          TIMESTAMPTZ,
    metadata              JSONB,
    tags                  TEXT[],
    device_group_ids      INT[]
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, c.name, c.kind, c.fingerprint_sha256,
           c.subject_cn, c.issuer_cn, c.sans, c.key_algo, c.chain_depth,
           c.basic_constraints_ca, c.not_before, c.not_after, c.slot_compat,
           c.device_compatible, c.incompat_reasons, c.source, c.created_at,
           c.created_by::text, c.last_used_at, c.metadata, c.tags,
           COALESCE(
               (SELECT array_agg(cdg.group_id ORDER BY cdg.group_id)
                  FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id),
               ARRAY[]::int[]
           ) AS device_group_ids
      FROM organization.certificates c
     WHERE c.tenant_id = p_tenant_id
       AND (p_kind   IS NULL OR c.kind   = p_kind)
       AND (p_source IS NULL OR c.source = p_source)
       AND (p_slot   IS NULL OR p_slot = ANY(c.slot_compat))
       AND (p_tag    IS NULL OR p_tag  = ANY(c.tags))
       AND (p_group_id IS NULL OR EXISTS (
                SELECT 1 FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id
                   AND cdg.group_id = p_group_id))
       AND (p_expiring_within_days IS NULL
            OR (c.not_after IS NOT NULL
                AND c.not_after <= now() + make_interval(days => p_expiring_within_days)))
     ORDER BY c.created_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

DROP FUNCTION IF EXISTS organization.fn_certificate_list_pushes(
    VARCHAR, UUID, VARCHAR, UUID, INT, INT
);

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
