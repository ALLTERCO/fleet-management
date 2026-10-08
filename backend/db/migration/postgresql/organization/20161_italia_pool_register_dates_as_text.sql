--------------UP
-- Register dates return as 'YYYY-MM-DD' text so no driver or host time zone shifts them.
DROP FUNCTION IF EXISTS organization.fn_italia_pool_register_entry_upsert(VARCHAR, BIGINT, VARCHAR, DATE, VARCHAR, JSONB, VARCHAR);
CREATE OR REPLACE FUNCTION organization.fn_italia_pool_register_entry_upsert(
    p_organization_id VARCHAR,
    p_site_id BIGINT,
    p_pool_id VARCHAR,
    p_register_date DATE,
    p_entry VARCHAR,
    p_value JSONB,
    p_accepted_by VARCHAR
)
RETURNS TABLE(
    organization_id VARCHAR,
    site_id BIGINT,
    pool_id VARCHAR,
    register_date TEXT,
    entry VARCHAR,
    value JSONB,
    accepted_by VARCHAR,
    accepted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_organization_id IS NULL OR p_organization_id = ''
       OR p_site_id < 1 OR p_pool_id IS NULL OR p_pool_id = ''
       OR p_register_date IS NULL OR p_entry IS NULL OR p_value IS NULL THEN
        RAISE EXCEPTION 'Italia pool register address and value are required'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    INSERT INTO organization.italia_pool_register_entry AS stored (
        organization_id,
        site_id,
        pool_id,
        register_date,
        entry,
        value,
        accepted_by,
        accepted_at
    ) VALUES (
        p_organization_id,
        p_site_id,
        p_pool_id,
        p_register_date,
        p_entry,
        p_value,
        p_accepted_by,
        NOW()
    )
    ON CONFLICT ON CONSTRAINT italia_pool_register_entry_pkey DO UPDATE
       SET value = EXCLUDED.value,
           accepted_by = EXCLUDED.accepted_by,
           accepted_at = EXCLUDED.accepted_at
    RETURNING
        stored.organization_id,
        stored.site_id,
        stored.pool_id,
        to_char(stored.register_date, 'YYYY-MM-DD'),
        stored.entry,
        stored.value,
        stored.accepted_by,
        stored.accepted_at;
END;
$$;

DROP FUNCTION IF EXISTS organization.fn_italia_pool_register_entry_list(VARCHAR, BIGINT, VARCHAR, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_italia_pool_register_entry_list(
    p_organization_id VARCHAR,
    p_site_id BIGINT,
    p_pool_id VARCHAR,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE(
    organization_id VARCHAR,
    site_id BIGINT,
    pool_id VARCHAR,
    register_date TEXT,
    entry VARCHAR,
    value JSONB,
    accepted_by VARCHAR,
    accepted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        stored.organization_id,
        stored.site_id,
        stored.pool_id,
        to_char(stored.register_date, 'YYYY-MM-DD'),
        stored.entry,
        stored.value,
        stored.accepted_by,
        stored.accepted_at
      FROM organization.italia_pool_register_entry AS stored
     WHERE stored.organization_id = p_organization_id
       AND stored.site_id = p_site_id
       AND stored.pool_id = p_pool_id
       AND stored.register_date BETWEEN p_from AND p_to
     ORDER BY stored.register_date, stored.entry;
$$;

--------------DOWN
-- Restore the DATE-returning register reads from 7381.
DROP FUNCTION IF EXISTS organization.fn_italia_pool_register_entry_upsert(VARCHAR, BIGINT, VARCHAR, DATE, VARCHAR, JSONB, VARCHAR);
CREATE OR REPLACE FUNCTION organization.fn_italia_pool_register_entry_upsert(
    p_organization_id VARCHAR,
    p_site_id BIGINT,
    p_pool_id VARCHAR,
    p_register_date DATE,
    p_entry VARCHAR,
    p_value JSONB,
    p_accepted_by VARCHAR
)
RETURNS TABLE(
    organization_id VARCHAR,
    site_id BIGINT,
    pool_id VARCHAR,
    register_date DATE,
    entry VARCHAR,
    value JSONB,
    accepted_by VARCHAR,
    accepted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_organization_id IS NULL OR p_organization_id = ''
       OR p_site_id < 1 OR p_pool_id IS NULL OR p_pool_id = ''
       OR p_register_date IS NULL OR p_entry IS NULL OR p_value IS NULL THEN
        RAISE EXCEPTION 'Italia pool register address and value are required'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    INSERT INTO organization.italia_pool_register_entry AS stored (
        organization_id,
        site_id,
        pool_id,
        register_date,
        entry,
        value,
        accepted_by,
        accepted_at
    ) VALUES (
        p_organization_id,
        p_site_id,
        p_pool_id,
        p_register_date,
        p_entry,
        p_value,
        p_accepted_by,
        NOW()
    )
    ON CONFLICT ON CONSTRAINT italia_pool_register_entry_pkey DO UPDATE
       SET value = EXCLUDED.value,
           accepted_by = EXCLUDED.accepted_by,
           accepted_at = EXCLUDED.accepted_at
    RETURNING
        stored.organization_id,
        stored.site_id,
        stored.pool_id,
        stored.register_date,
        stored.entry,
        stored.value,
        stored.accepted_by,
        stored.accepted_at;
END;
$$;

DROP FUNCTION IF EXISTS organization.fn_italia_pool_register_entry_list(VARCHAR, BIGINT, VARCHAR, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_italia_pool_register_entry_list(
    p_organization_id VARCHAR,
    p_site_id BIGINT,
    p_pool_id VARCHAR,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE(
    organization_id VARCHAR,
    site_id BIGINT,
    pool_id VARCHAR,
    register_date DATE,
    entry VARCHAR,
    value JSONB,
    accepted_by VARCHAR,
    accepted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        stored.organization_id,
        stored.site_id,
        stored.pool_id,
        stored.register_date,
        stored.entry,
        stored.value,
        stored.accepted_by,
        stored.accepted_at
      FROM organization.italia_pool_register_entry AS stored
     WHERE stored.organization_id = p_organization_id
       AND stored.site_id = p_site_id
       AND stored.pool_id = p_pool_id
       AND stored.register_date BETWEEN p_from AND p_to
     ORDER BY stored.register_date, stored.entry;
$$;
