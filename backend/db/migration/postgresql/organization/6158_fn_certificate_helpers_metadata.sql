--------------UP
-- Replaces fn_certificate_list/get/import to include metadata + tags
-- in their RETURNS shape, adds tag filter to list, and adds the new
-- fn_certificate_set_tags writer. DROP-then-CREATE because PG forbids
-- mutating a function's return-table columns via CREATE OR REPLACE.

SET search_path TO organization;

DROP FUNCTION IF EXISTS organization.fn_certificate_list(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT
);

CREATE FUNCTION organization.fn_certificate_list(
    p_tenant_id            VARCHAR,
    p_kind                 VARCHAR,
    p_source               VARCHAR,
    p_slot                 VARCHAR,
    p_tag                  VARCHAR,
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
    tags                  TEXT[]
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, name, kind, fingerprint_sha256,
           subject_cn, issuer_cn, sans, key_algo, chain_depth,
           basic_constraints_ca, not_before, not_after, slot_compat,
           device_compatible, incompat_reasons, source, created_at,
           created_by::text, last_used_at, metadata, tags
      FROM organization.certificates
     WHERE tenant_id = p_tenant_id
       AND (p_kind   IS NULL OR kind   = p_kind)
       AND (p_source IS NULL OR source = p_source)
       AND (p_slot   IS NULL OR p_slot = ANY(slot_compat))
       AND (p_tag    IS NULL OR p_tag  = ANY(tags))
       AND (p_expiring_within_days IS NULL
            OR (not_after IS NOT NULL
                AND not_after <= now() + make_interval(days => p_expiring_within_days)))
     ORDER BY created_at DESC
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
    pem                   TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, name, kind, fingerprint_sha256,
           subject_cn, issuer_cn, sans, key_algo, chain_depth,
           basic_constraints_ca, not_before, not_after, slot_compat,
           device_compatible, incompat_reasons, source, created_at,
           created_by::text, last_used_at, metadata, tags,
           CASE WHEN p_include_pem THEN pem ELSE NULL END
      FROM organization.certificates
     WHERE id = p_id AND tenant_id = p_tenant_id;
$$;

DROP FUNCTION IF EXISTS organization.fn_certificate_import(
    VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, VARCHAR, VARCHAR, VARCHAR,
    TEXT[], VARCHAR, INT, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[],
    BOOLEAN, TEXT[], VARCHAR, VARCHAR
);

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
    p_created_by            VARCHAR,
    p_metadata              JSONB,
    p_tags                  TEXT[]
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
         source, created_by, metadata, tags)
    VALUES
        (p_tenant_id, p_name, p_kind, p_pem, p_private_key_encrypted,
         p_fingerprint_sha256, p_subject_cn, p_issuer_cn, p_sans,
         p_key_algo, p_chain_depth, p_basic_constraints_ca,
         p_not_before, p_not_after,
         p_slot_compat, p_device_compatible, p_incompat_reasons,
         p_source, p_created_by,
         COALESCE(p_metadata, '{}'::jsonb),
         COALESCE(p_tags, '{}'::text[]))
    ON CONFLICT (tenant_id, fingerprint_sha256) DO UPDATE
        SET name = EXCLUDED.name,
            metadata = EXCLUDED.metadata
    RETURNING id::text, tenant_id::text, name, kind, fingerprint_sha256,
              subject_cn, issuer_cn, sans, key_algo, chain_depth,
              basic_constraints_ca, not_before, not_after, slot_compat,
              device_compatible, incompat_reasons, source, created_at,
              created_by::text, last_used_at,
              metadata, tags, (xmax <> 0);
$$;

CREATE OR REPLACE FUNCTION organization.fn_certificate_set_tags(
    p_id        UUID,
    p_tenant_id VARCHAR,
    p_tags      TEXT[]
)
RETURNS TABLE (
    id    TEXT,
    tags  TEXT[]
)
LANGUAGE sql
AS $$
    UPDATE organization.certificates
       SET tags = COALESCE(p_tags, '{}'::text[])
     WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING id::text, tags;
$$;

--------------DOWN
SET search_path TO organization;
DROP FUNCTION IF EXISTS organization.fn_certificate_set_tags(UUID, VARCHAR, TEXT[]);
DROP FUNCTION IF EXISTS organization.fn_certificate_import(
    VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, VARCHAR, VARCHAR, VARCHAR,
    TEXT[], VARCHAR, INT, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[],
    BOOLEAN, TEXT[], VARCHAR, VARCHAR, JSONB, TEXT[]
);
DROP FUNCTION IF EXISTS organization.fn_certificate_get(UUID, VARCHAR, BOOLEAN);
DROP FUNCTION IF EXISTS organization.fn_certificate_list(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INT, INT, INT
);
