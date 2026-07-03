--------------UP
-- Adds device_group_ids + p_group_id filter to list/get + the
-- fn_certificate_set_groups writer. Aggregate inline so callers don't N+1.

SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_certificate_list(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT
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

DROP FUNCTION IF EXISTS organization.fn_certificate_get(UUID, VARCHAR, BOOLEAN);

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
    metadata              JSONB,
    tags                  TEXT[],
    device_group_ids      INT[],
    pem                   TEXT
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
           CASE WHEN p_include_pem THEN c.pem ELSE NULL END
      FROM organization.certificates c
     WHERE c.id = p_id AND c.tenant_id = p_tenant_id;
$$;

-- Wholesale replace: delete-all + insert-new in one tx. Raises if
-- any group_id belongs to a different tenant.
CREATE OR REPLACE FUNCTION organization.fn_certificate_set_groups(
    p_id         UUID,
    p_tenant_id  VARCHAR,
    p_group_ids  INT[],
    p_actor      VARCHAR
)
RETURNS INT[]
AS $$
DECLARE
    v_cert_exists BOOLEAN;
    v_invalid_ids INT[];
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM organization.certificates
         WHERE id = p_id AND tenant_id = p_tenant_id
    ) INTO v_cert_exists;
    IF NOT v_cert_exists THEN
        RAISE EXCEPTION 'certificate % not found in tenant %', p_id, p_tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- Surface offending group ids so the caller can name them.
    SELECT COALESCE(array_agg(gid), ARRAY[]::int[]) INTO v_invalid_ids
      FROM unnest(COALESCE(p_group_ids, ARRAY[]::int[])) AS gid
     WHERE NOT EXISTS (
        SELECT 1 FROM organization.groups
         WHERE id = gid AND organization_id = p_tenant_id
     );
    IF array_length(v_invalid_ids, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'groups %s not in tenant %', v_invalid_ids, p_tenant_id
            USING ERRCODE = '23503';
    END IF;

    DELETE FROM organization.certificate_device_groups
     WHERE certificate_id = p_id;

    INSERT INTO organization.certificate_device_groups
        (certificate_id, group_id, created_by)
    SELECT p_id, gid, p_actor
      FROM unnest(COALESCE(p_group_ids, ARRAY[]::int[])) AS gid;

    RETURN COALESCE(
        (SELECT array_agg(group_id ORDER BY group_id)
           FROM organization.certificate_device_groups
          WHERE certificate_id = p_id),
        ARRAY[]::int[]
    );
END;
$$
LANGUAGE plpgsql;

--------------DOWN
SET search_path TO organization;
DROP FUNCTION IF EXISTS organization.fn_certificate_set_groups(UUID, VARCHAR, INT[], VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_certificate_get(UUID, VARCHAR, BOOLEAN);
DROP FUNCTION IF EXISTS organization.fn_certificate_list(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT, INT
);
