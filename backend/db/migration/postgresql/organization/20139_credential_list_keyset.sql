--------------UP
SET search_path TO public;

-- No index served rotated_at order, so every page sorted the tenant's
-- active credentials (EXPLAIN on a seeded test DB).
CREATE INDEX IF NOT EXISTS device_credentials_active_by_rotated
    ON organization.device_credentials (tenant_id, rotated_at DESC, id DESC)
    WHERE retired_at IS NULL;

-- A new function, so fn_credential_list stays for the previous release
-- during a rolling deploy and its own migration keeps owning it.
-- p_after: keyset position [rotated_at as microsecond text, id]. The count
-- moves out of a window function so a cursor page can skip it.
CREATE OR REPLACE FUNCTION organization.fn_credential_page(
    p_tenant_id    VARCHAR,
    p_device_id    VARCHAR,
    p_status       VARCHAR,
    p_limit        INT,
    p_offset       INT,
    p_after        JSONB DEFAULT NULL,
    p_skip_total   BOOLEAN DEFAULT NULL
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
    total_count INT,
    cursor_key JSONB
)
LANGUAGE sql
STABLE
AS $$
    WITH filtered AS NOT MATERIALIZED (
        SELECT c.id, c.tenant_id, d.external_id, c.username, c.rotated_at,
               c.rotated_by, c.last_rotation_status, c.last_rotation_error
          FROM organization.device_credentials c
          JOIN device.list d
            ON d.id = c.logical_device_id
           AND d.organization_id = c.tenant_id
         WHERE c.tenant_id = p_tenant_id
           AND c.retired_at IS NULL
           AND (p_device_id IS NULL OR d.external_id = p_device_id)
           AND (p_status IS NULL OR c.last_rotation_status = p_status)
    ),
    total AS (
        SELECT count(*)::INT AS c FROM filtered WHERE p_skip_total IS NOT TRUE
    )
    SELECT page.id::text, page.tenant_id::text, page.external_id,
           page.username, page.external_id, page.rotated_at, page.rotated_by,
           page.last_rotation_status, page.last_rotation_error,
           CASE WHEN p_skip_total THEN NULL ELSE total.c END,
           jsonb_build_array(
               to_char(page.rotated_at AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               page.id::text)
      FROM total
      JOIN LATERAL (
          SELECT *
            FROM filtered f
           WHERE p_after IS NULL
              OR (f.rotated_at <= (p_after->>0)::TIMESTAMPTZ
                  AND (f.rotated_at, f.id)
                      < ((p_after->>0)::TIMESTAMPTZ, (p_after->>1)::UUID))
           ORDER BY f.rotated_at DESC, f.id DESC
           LIMIT p_limit OFFSET p_offset
      ) page ON TRUE
     ORDER BY page.rotated_at DESC, page.id DESC;
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS organization.fn_credential_page(VARCHAR, VARCHAR, VARCHAR, INT, INT, JSONB, BOOLEAN);
DROP INDEX IF EXISTS organization.device_credentials_active_by_rotated;
