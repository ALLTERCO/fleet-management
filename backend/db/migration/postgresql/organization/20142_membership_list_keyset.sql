--------------UP
SET search_path TO public;

-- Keyset paging for group members and location assignments, in the same
-- order as before (20104). Nullable sort columns become an (is null, value)
-- pair so the key compares as a row and NULLs still sort last. The order
-- uses device.list external ids, so no index can serve it; a cursor page
-- still sorts the scope's rows but no longer counts them or skips an offset.
-- New functions, so the 20104 ones stay for the previous release during a
-- rolling deploy and their own migration keeps owning them.

CREATE OR REPLACE FUNCTION organization.fn_group_members_page(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_after           JSONB DEFAULT NULL,
    p_skip_total      BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
    total_count BIGINT,
    group_id INTEGER,
    subject_type VARCHAR,
    subject_id VARCHAR,
    created_at TIMESTAMPTZ,
    cursor_key JSONB
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT gm.group_id,
               gm.subject_type,
               CASE
                   WHEN gm.subject_type = 'device' THEN dl.external_id
                   WHEN gm.subject_type = 'entity' AND gm.device_id IS NOT NULL
                       THEN gm.device_id::TEXT || '_' || gm.entity_suffix
                   ELSE gm.subject_id
               END::VARCHAR AS subject_id,
               gm.subject_id AS storage_subject_id,
               gm.device_id AS storage_device_id,
               gm.entity_suffix AS storage_entity_suffix,
               gm.created_at
          FROM organization.group_members gm
          LEFT JOIN device.list dl ON dl.id = gm.device_id
         WHERE gm.organization_id = p_organization_id
           AND gm.group_id = p_group_id
           AND (p_subject_type IS NULL OR gm.subject_type = p_subject_type)
    ), keyed AS (
        SELECT *,
               subject_type AS k_type,
               subject_id IS NULL AS k_sid_null,
               COALESCE(subject_id, '') AS k_sid,
               storage_device_id IS NULL AS k_did_null,
               COALESCE(storage_device_id, 0) AS k_did,
               storage_subject_id IS NULL AS k_ssid_null,
               COALESCE(storage_subject_id, '') AS k_ssid,
               storage_entity_suffix IS NULL AS k_suf_null,
               COALESCE(storage_entity_suffix, '') AS k_suf
          FROM filtered
    ), total AS (
        SELECT count(*) AS c FROM keyed WHERE p_skip_total IS NOT TRUE
    )
    SELECT CASE WHEN p_skip_total THEN NULL ELSE total.c END,
           page.group_id, page.subject_type, page.subject_id, page.created_at,
           CASE WHEN page.k_type IS NOT NULL THEN jsonb_build_array(
               page.k_type, page.k_sid_null, page.k_sid, page.k_did_null,
               page.k_did, page.k_ssid_null, page.k_ssid, page.k_suf_null,
               page.k_suf) END
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM keyed
           WHERE p_after IS NULL
              OR (k_type, k_sid_null, k_sid, k_did_null, k_did,
                  k_ssid_null, k_ssid, k_suf_null, k_suf)
                 > (p_after->>0, (p_after->>1)::BOOLEAN, p_after->>2,
                    (p_after->>3)::BOOLEAN, (p_after->>4)::INTEGER,
                    (p_after->>5)::BOOLEAN, p_after->>6,
                    (p_after->>7)::BOOLEAN, p_after->>8)
           ORDER BY k_type, k_sid_null, k_sid, k_did_null, k_did,
                    k_ssid_null, k_ssid, k_suf_null, k_suf
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE
     ORDER BY page.k_type, page.k_sid_null, page.k_sid, page.k_did_null,
              page.k_did, page.k_ssid_null, page.k_ssid, page.k_suf_null,
              page.k_suf;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_assignments_page(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_subject_id      VARCHAR DEFAULT NULL,
    p_location_id     INTEGER DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_allowed_ids     INTEGER[] DEFAULT NULL,
    p_location_ids    INTEGER[] DEFAULT NULL,
    p_after           JSONB DEFAULT NULL,
    p_skip_total      BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
    total_count BIGINT,
    organization_id VARCHAR,
    subject_type VARCHAR,
    subject_id VARCHAR,
    location_id INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    cursor_key JSONB
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS (
        SELECT la.organization_id,
               la.subject_type,
               CASE
                   WHEN la.subject_type = 'device' THEN dl.external_id
                   WHEN la.subject_type = 'entity' AND la.device_id IS NOT NULL
                       THEN la.device_id::TEXT || '_' || la.entity_suffix
                   ELSE la.subject_id
               END::VARCHAR AS subject_id,
               la.location_id,
               la.subject_id AS storage_subject_id,
               la.device_id AS storage_device_id,
               la.entity_suffix AS storage_entity_suffix,
               la.created_at,
               la.updated_at
          FROM organization.location_assignments la
          LEFT JOIN device.list dl ON dl.id = la.device_id
         WHERE la.organization_id = p_organization_id
           AND (p_subject_type IS NULL OR la.subject_type = p_subject_type)
           AND (p_location_id IS NULL OR la.location_id = p_location_id)
           AND (p_location_ids IS NULL OR la.location_id = ANY(p_location_ids))
           AND (p_allowed_ids IS NULL OR la.location_id = ANY(p_allowed_ids))
    ), keyed AS (
        SELECT *,
               subject_type AS k_type,
               subject_id IS NULL AS k_sid_null,
               COALESCE(subject_id, '') AS k_sid,
               storage_device_id IS NULL AS k_did_null,
               COALESCE(storage_device_id, 0) AS k_did,
               storage_subject_id IS NULL AS k_ssid_null,
               COALESCE(storage_subject_id, '') AS k_ssid,
               storage_entity_suffix IS NULL AS k_suf_null,
               COALESCE(storage_entity_suffix, '') AS k_suf
          FROM filtered
         WHERE p_subject_id IS NULL OR subject_id = p_subject_id
    ), total AS (
        SELECT count(*) AS c FROM keyed WHERE p_skip_total IS NOT TRUE
    )
    SELECT CASE WHEN p_skip_total THEN NULL ELSE total.c END,
           page.organization_id, page.subject_type, page.subject_id,
           page.location_id, page.created_at, page.updated_at,
           CASE WHEN page.k_type IS NOT NULL THEN jsonb_build_array(
               page.k_type, page.k_sid_null, page.k_sid, page.k_did_null,
               page.k_did, page.k_ssid_null, page.k_ssid, page.k_suf_null,
               page.k_suf) END
      FROM total
      LEFT JOIN LATERAL (
          SELECT * FROM keyed
           WHERE p_after IS NULL
              OR (k_type, k_sid_null, k_sid, k_did_null, k_did,
                  k_ssid_null, k_ssid, k_suf_null, k_suf)
                 > (p_after->>0, (p_after->>1)::BOOLEAN, p_after->>2,
                    (p_after->>3)::BOOLEAN, (p_after->>4)::INTEGER,
                    (p_after->>5)::BOOLEAN, p_after->>6,
                    (p_after->>7)::BOOLEAN, p_after->>8)
           ORDER BY k_type, k_sid_null, k_sid, k_did_null, k_did,
                    k_ssid_null, k_ssid, k_suf_null, k_suf
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE
     ORDER BY page.k_type, page.k_sid_null, page.k_sid, page.k_did_null,
              page.k_did, page.k_ssid_null, page.k_ssid, page.k_suf_null,
              page.k_suf;
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS organization.fn_group_members_page(VARCHAR, INTEGER, VARCHAR, INTEGER, INTEGER, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS organization.fn_location_assignments_page(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER[], INTEGER[], JSONB, BOOLEAN);
