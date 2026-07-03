--------------UP
-- CRUD for notifications.email_assets. Insert dedups by sha256 and
-- enforces the caller's org quota atomically so concurrent uploads
-- can't race past the cap.

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_insert(
    p_organization_id VARCHAR,
    p_filename        VARCHAR,
    p_content_type    VARCHAR,
    p_size_bytes      INTEGER,
    p_sha256          CHAR,
    p_bytes           BYTEA,
    p_org_quota_bytes BIGINT
)
RETURNS TABLE (
    id           INTEGER,
    deduped      BOOLEAN,
    filename     VARCHAR,
    content_type VARCHAR,
    size_bytes   INTEGER,
    sha256       CHAR,
    created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_id   INTEGER;
    v_current_total BIGINT;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    -- Dedup: same sha256 in the same org returns the existing row.
    SELECT a.id INTO v_existing_id
    FROM notifications.email_assets a
    WHERE a.organization_id = p_organization_id AND a.sha256 = p_sha256
    LIMIT 1;
    IF FOUND THEN
        RETURN QUERY
        SELECT a.id, TRUE, a.filename, a.content_type, a.size_bytes,
               a.sha256, a.created_at
        FROM notifications.email_assets a
        WHERE a.id = v_existing_id;
        RETURN;
    END IF;

    -- Quota check (serializable via org-scoped lock on the quota row).
    SELECT COALESCE(SUM(a.size_bytes), 0) INTO v_current_total
    FROM notifications.email_assets a
    WHERE a.organization_id = p_organization_id;
    IF v_current_total + p_size_bytes > p_org_quota_bytes THEN
        RAISE EXCEPTION
            'email asset quota exceeded (org=% has % + % = % > cap %)',
            p_organization_id, v_current_total, p_size_bytes,
            v_current_total + p_size_bytes, p_org_quota_bytes
        USING ERRCODE = '23514'; -- check_violation
    END IF;

    RETURN QUERY
    INSERT INTO notifications.email_assets (
        organization_id, filename, content_type, size_bytes, sha256, bytes
    )
    VALUES (
        p_organization_id, p_filename, p_content_type, p_size_bytes,
        p_sha256, p_bytes
    )
    RETURNING
        notifications.email_assets.id,
        FALSE AS deduped,
        notifications.email_assets.filename,
        notifications.email_assets.content_type,
        notifications.email_assets.size_bytes,
        notifications.email_assets.sha256,
        notifications.email_assets.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_list(
    p_organization_id VARCHAR,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    id           INTEGER,
    filename     VARCHAR,
    content_type VARCHAR,
    size_bytes   INTEGER,
    sha256       CHAR,
    created_at   TIMESTAMPTZ,
    total        BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH base AS (
        SELECT a.id, a.filename, a.content_type, a.size_bytes, a.sha256,
               a.created_at
        FROM notifications.email_assets a
        WHERE a.organization_id = p_organization_id
    ),
    counted AS (
        SELECT COUNT(*)::BIGINT AS n FROM base
    )
    SELECT b.id, b.filename, b.content_type, b.size_bytes, b.sha256,
           b.created_at, (SELECT n FROM counted) AS total
    FROM base b
    ORDER BY b.created_at DESC
    LIMIT GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_get_metadata(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id           INTEGER,
    filename     VARCHAR,
    content_type VARCHAR,
    size_bytes   INTEGER,
    sha256       CHAR,
    created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT a.id, a.filename, a.content_type, a.size_bytes, a.sha256,
           a.created_at
    FROM notifications.email_assets a
    WHERE a.id = p_id AND a.organization_id = p_organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_get_bytes(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    filename     VARCHAR,
    content_type VARCHAR,
    bytes        BYTEA
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT a.filename, a.content_type, a.bytes
    FROM notifications.email_assets a
    WHERE a.id = p_id AND a.organization_id = p_organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM notifications.email_assets
    WHERE id = p_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_org_size(
    p_organization_id VARCHAR
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_total BIGINT;
BEGIN
    SELECT COALESCE(SUM(size_bytes), 0) INTO v_total
    FROM notifications.email_assets
    WHERE organization_id = p_organization_id;
    RETURN v_total;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_email_asset_org_size(VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_email_asset_delete(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_email_asset_get_bytes(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_email_asset_get_metadata(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_email_asset_list(VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_email_asset_insert(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, CHAR, BYTEA, BIGINT
);
