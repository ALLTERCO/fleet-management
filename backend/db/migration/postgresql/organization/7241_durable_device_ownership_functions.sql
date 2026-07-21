--------------UP
-- API parameters remain Shelly IDs. Tables resolve them to logical IDs once.

CREATE OR REPLACE FUNCTION organization.fn_credential_stage_push(
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
    v_logical_device_id INT;
    v_old_ha1 VARCHAR;
    v_push_id INT;
BEGIN
    v_logical_device_id := organization.fn_require_logical_device_id(
        p_tenant_id, p_device_id
    );
    PERFORM pg_advisory_xact_lock(
        hashtext(p_tenant_id), v_logical_device_id
    );

    SELECT ha1_hex INTO v_old_ha1
      FROM organization.device_credentials
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = v_logical_device_id
       AND retired_at IS NULL;

    INSERT INTO organization.credential_pushes (
        job_id, tenant_id, device_id, logical_device_id, status,
        ha1_old_hex, ha1_new_hex, password_encrypted, requested_by
    ) VALUES (
        p_job_id, p_tenant_id, p_device_id, v_logical_device_id, 'queued',
        v_old_ha1, p_ha1_new_hex, p_password_encrypted, p_requested_by
    )
    RETURNING id INTO v_push_id;
    RETURN v_push_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_finalize_ok(
    p_tenant_id           VARCHAR,
    p_device_id           VARCHAR,
    p_password_encrypted  TEXT,
    p_ha1_hex             VARCHAR,
    p_rotated_by          VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_logical_device_id INT;
BEGIN
    v_logical_device_id := organization.fn_require_logical_device_id(
        p_tenant_id, p_device_id
    );

    UPDATE organization.device_credentials
       SET device_id = p_device_id,
           realm = p_device_id,
           password_encrypted = p_password_encrypted,
           ha1_hex = p_ha1_hex,
           rotated_at = now(),
           rotated_by = p_rotated_by,
           last_rotation_status = 'ok',
           last_rotation_error = NULL
     WHERE tenant_id = p_tenant_id
       AND logical_device_id = v_logical_device_id
       AND retired_at IS NULL;

    IF NOT FOUND THEN
        INSERT INTO organization.device_credentials (
            tenant_id, device_id, logical_device_id, username, realm,
            password_encrypted, ha1_hex, rotated_at, rotated_by,
            last_rotation_status, last_rotation_error
        ) VALUES (
            p_tenant_id, p_device_id, v_logical_device_id, 'admin', p_device_id,
            p_password_encrypted, p_ha1_hex, now(), p_rotated_by, 'ok', NULL
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_finalize_failed(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_error TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE organization.device_credentials c
       SET last_rotation_status = 'failed',
           last_rotation_error = p_error
     WHERE c.tenant_id = p_tenant_id
       AND c.logical_device_id = organization.fn_require_logical_device_id(
           p_tenant_id, p_device_id
       )
       AND c.retired_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_get(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.logical_device_id = organization.fn_require_logical_device_id(
           p_tenant_id, p_device_id
       )
       AND c.retired_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_get_password(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR
)
RETURNS TABLE (
    password_encrypted TEXT,
    realm VARCHAR,
    username VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.password_encrypted, d.external_id, c.username
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.logical_device_id = organization.fn_require_logical_device_id(
           p_tenant_id, p_device_id
       )
       AND c.retired_at IS NULL;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_list(
    VARCHAR, VARCHAR, VARCHAR, INT, INT
);
CREATE FUNCTION organization.fn_credential_list(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_status VARCHAR,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error,
           COUNT(*) OVER()::INT
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND (p_device_id IS NULL OR d.external_id = p_device_id)
       AND (p_status IS NULL OR c.last_rotation_status = p_status)
     ORDER BY c.rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_list_failed(
    VARCHAR, INT, INT
);
CREATE FUNCTION organization.fn_credential_list_failed(
    p_tenant_id VARCHAR,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error,
           COUNT(*) OVER()::INT
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND c.last_rotation_status <> 'ok'
     ORDER BY c.rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_list_flagged_ids(
    p_tenant_id VARCHAR,
    p_device_ids VARCHAR[]
)
RETURNS TABLE (device_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT d.external_id
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND d.external_id = ANY(p_device_ids)
       AND c.last_rotation_status <> 'ok';
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_clear_rows(
    p_tenant_id VARCHAR,
    p_device_ids VARCHAR[]
)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM organization.device_credentials c
     USING device.list d
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
       AND d.external_id = ANY(p_device_ids);
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_rollback_to_old(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_ha1_old_hex VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE organization.device_credentials c
       SET ha1_hex = p_ha1_old_hex,
           last_rotation_status = 'ok',
           last_rotation_error = NULL
     WHERE c.tenant_id = p_tenant_id
       AND c.logical_device_id = organization.fn_require_logical_device_id(
           p_tenant_id, p_device_id
       )
       AND c.retired_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_confirm_old(
    p_push_id INT,
    p_tenant_id VARCHAR
)
RETURNS TABLE (device_id VARCHAR, ha1_old_hex VARCHAR)
LANGUAGE plpgsql
AS $$
DECLARE
    v_device_id VARCHAR;
    v_logical_device_id INT;
    v_ha1_old_hex VARCHAR;
BEGIN
    UPDATE organization.credential_pushes p
       SET status = 'ok'
      FROM organization.credential_jobs j
     WHERE p.id = p_push_id
       AND p.job_id = j.id
       AND j.tenant_id = p_tenant_id
       AND p.status IN ('failed', 'unknown')
    RETURNING p.device_id, p.logical_device_id, p.ha1_old_hex
         INTO v_device_id, v_logical_device_id, v_ha1_old_hex;

    IF v_device_id IS NULL THEN
        RETURN;
    END IF;
    IF v_ha1_old_hex IS NULL THEN
        DELETE FROM organization.device_credentials
         WHERE tenant_id = p_tenant_id
           AND logical_device_id = v_logical_device_id
           AND device_id = v_device_id
           AND retired_at IS NULL;
    END IF;
    RETURN QUERY SELECT v_device_id, v_ha1_old_hex;
END;
$$;

DROP FUNCTION IF EXISTS organization.fn_credential_list_pushes(
    VARCHAR, VARCHAR, UUID, VARCHAR, INT, INT
);
CREATE FUNCTION organization.fn_credential_list_pushes(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_job_id UUID,
    p_status VARCHAR,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id INT,
    job_id TEXT,
    device_id VARCHAR,
    status VARCHAR,
    last_error TEXT,
    applied_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    retry_count INT,
    requested_by VARCHAR,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.job_id::text, p.device_id, p.status, p.last_error,
           p.applied_at, p.picked_up_at, p.retry_count, p.requested_by,
           COUNT(*) OVER()::INT
      FROM organization.credential_pushes p
     WHERE p.tenant_id = p_tenant_id
       AND (p_device_id IS NULL OR p.logical_device_id =
           organization.fn_require_logical_device_id(p_tenant_id, p_device_id))
       AND (p_job_id IS NULL OR p.job_id = p_job_id)
       AND (p_status IS NULL OR p.status = p_status)
     ORDER BY p.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

DROP FUNCTION IF EXISTS organization.fn_certificate_list_pushes(
    VARCHAR, UUID, VARCHAR, UUID, INT, INT
);
CREATE FUNCTION organization.fn_certificate_list_pushes(
    p_tenant_id VARCHAR,
    p_certificate_id UUID,
    p_device_id VARCHAR,
    p_job_id UUID,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id INT,
    job_id TEXT,
    certificate_id TEXT,
    device_id VARCHAR,
    slot VARCHAR,
    status VARCHAR,
    last_error TEXT,
    applied_at TIMESTAMPTZ,
    requires_reboot BOOLEAN,
    retry_count INT,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.job_id::text, p.certificate_id::text, p.device_id,
           p.slot, p.status, p.last_error, p.applied_at,
           p.requires_reboot, p.retry_count, COUNT(*) OVER()::INT
      FROM organization.certificate_pushes p
      JOIN organization.certificates c ON c.id = p.certificate_id
     WHERE c.tenant_id = p_tenant_id
       AND (p_certificate_id IS NULL OR p.certificate_id = p_certificate_id)
       AND (p_device_id IS NULL OR p.logical_device_id =
           organization.fn_require_logical_device_id(p_tenant_id, p_device_id))
       AND (p_job_id IS NULL OR p.job_id = p_job_id)
     ORDER BY p.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_certificate_delete_safe(
    p_id UUID,
    p_tenant_id VARCHAR
)
RETURNS TABLE (live_count INT, deleted_count INT)
LANGUAGE sql
AS $$
    WITH live AS (
        SELECT 1
          FROM organization.certificate_pushes cp
         WHERE cp.certificate_id = p_id
           AND cp.status = 'applied'
           AND NOT EXISTS (
               SELECT 1 FROM organization.certificate_pushes newer
                WHERE newer.logical_device_id = cp.logical_device_id
                  AND newer.slot = cp.slot
                  AND newer.status = 'applied'
                  AND newer.applied_at > cp.applied_at
           )
         LIMIT 1
    ), deleted AS (
        DELETE FROM organization.certificates
         WHERE id = p_id
           AND tenant_id = p_tenant_id
           AND NOT EXISTS (SELECT 1 FROM live)
        RETURNING id
    )
    SELECT (SELECT count(*)::INT FROM live),
           (SELECT count(*)::INT FROM deleted);
$$;

--------------DOWN
-- Forward-only logical identity migration.
