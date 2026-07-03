--------------UP
-- RPC helpers for policy.* — read, upsert-with-concurrency, reset.

-- Read all 12 potential (group_type, field_key) cells. Missing rows come
-- back with value=NULL + source='unset' so the API has a complete matrix.
-- VALUES lists coupled with GROUP_TYPES + POLICY_FIELD_KEYS (see 6092).
CREATE OR REPLACE FUNCTION organization.fn_policy_get_all()
RETURNS TABLE (
    group_type    VARCHAR,
    field_key     VARCHAR,
    value         VARCHAR,
    source        VARCHAR,
    updated_at    TIMESTAMPTZ,
    updated_by    VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    WITH cells AS (
        SELECT t.group_type, f.field_key
        FROM (VALUES ('standard'),('operational'),('critical'),('custom')) t(group_type)
        CROSS JOIN (VALUES ('severity_floor'),('retention_days'),('audit_retention_days')) f(field_key)
    )
    SELECT
        c.group_type::VARCHAR,
        c.field_key::VARCHAR,
        p.value,
        COALESCE(p.source, 'unset')::VARCHAR,
        COALESCE(p.updated_at, 'epoch'::TIMESTAMPTZ),
        p.updated_by
    FROM cells c
    LEFT JOIN organization.group_type_policy p
      ON p.group_type = c.group_type AND p.field_key = c.field_key
    ORDER BY c.group_type, c.field_key;
$$;

-- Upsert one field with optional stale-guard. Returns 0 rows when the
-- stale-guard rejects; returns 1 row on success. Caller distinguishes.
CREATE OR REPLACE FUNCTION organization.fn_policy_upsert_field(
    p_group_type         VARCHAR,
    p_field_key          VARCHAR,
    p_value              VARCHAR,
    p_source             VARCHAR,
    p_updated_by         VARCHAR,
    p_if_unchanged_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    group_type   VARCHAR,
    field_key    VARCHAR,
    value        VARCHAR,
    source       VARCHAR,
    updated_at   TIMESTAMPTZ,
    updated_by   VARCHAR,
    stale        BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing organization.group_type_policy%ROWTYPE;
BEGIN
    SELECT * INTO v_existing
    FROM organization.group_type_policy gp
    WHERE gp.group_type = p_group_type AND gp.field_key = p_field_key;

    IF FOUND AND p_if_unchanged_since IS NOT NULL
       AND v_existing.updated_at > p_if_unchanged_since THEN
        RETURN QUERY SELECT
            v_existing.group_type, v_existing.field_key, v_existing.value,
            v_existing.source, v_existing.updated_at, v_existing.updated_by,
            TRUE AS stale;
        RETURN;
    END IF;

    -- No-op: same value, same source — skip write so updated_at stays put.
    IF FOUND AND v_existing.value IS NOT DISTINCT FROM p_value
             AND v_existing.source = p_source THEN
        RETURN QUERY SELECT
            v_existing.group_type, v_existing.field_key, v_existing.value,
            v_existing.source, v_existing.updated_at, v_existing.updated_by,
            FALSE AS stale;
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO organization.group_type_policy AS gp
        (group_type, field_key, value, source, updated_at, updated_by)
    VALUES
        (p_group_type, p_field_key, p_value, p_source, NOW(), p_updated_by)
    ON CONFLICT (group_type, field_key) DO UPDATE
        SET value = EXCLUDED.value,
            source = EXCLUDED.source,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
    RETURNING
        gp.group_type, gp.field_key, gp.value, gp.source, gp.updated_at,
        gp.updated_by, FALSE AS stale;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_policy_get_all;
DROP FUNCTION organization.fn_policy_upsert_field;
