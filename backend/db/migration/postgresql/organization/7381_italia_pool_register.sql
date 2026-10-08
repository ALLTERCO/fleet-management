--------------UP
CREATE TABLE IF NOT EXISTS organization.italia_pool_chemistry_policy (
    organization_id VARCHAR NOT NULL,
    pool_id VARCHAR(120) NOT NULL,
    site_id BIGINT NOT NULL,
    policy JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, pool_id)
);

CREATE INDEX IF NOT EXISTS idx_italia_pool_chemistry_policy_site
    ON organization.italia_pool_chemistry_policy (
        organization_id,
        site_id,
        pool_id
    );

CREATE TABLE IF NOT EXISTS organization.italia_pool_register_entry (
    organization_id VARCHAR NOT NULL,
    site_id BIGINT NOT NULL,
    pool_id VARCHAR(120) NOT NULL,
    register_date DATE NOT NULL,
    entry VARCHAR(40) NOT NULL,
    value JSONB NOT NULL,
    accepted_by VARCHAR,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (
        organization_id,
        site_id,
        pool_id,
        register_date,
        entry
    ),
    CONSTRAINT italia_pool_register_entry_name CHECK (entry IN (
        'freeChlorine',
        'combinedChlorine',
        'temperature',
        'ph',
        'makeUpWaterMeter',
        'disinfectant',
        'samplingDate',
        'bathers'
    )),
    CONSTRAINT italia_pool_register_entry_value CHECK (
        (entry IN (
            'freeChlorine',
            'combinedChlorine',
            'temperature',
            'ph',
            'makeUpWaterMeter',
            'bathers'
        ) AND jsonb_typeof(value) = 'number')
        OR
        (entry IN ('disinfectant', 'samplingDate')
            AND jsonb_typeof(value) = 'string'
            AND length(btrim(value #>> '{}')) > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_italia_pool_register_range
    ON organization.italia_pool_register_entry (
        organization_id,
        site_id,
        pool_id,
        register_date,
        entry
    );

CREATE OR REPLACE FUNCTION organization.fn_italia_pool_chemistry_policy_list(
    p_organization_id VARCHAR
)
RETURNS TABLE(policy JSONB)
LANGUAGE sql
STABLE
AS $$
    SELECT stored.policy
      FROM organization.italia_pool_chemistry_policy AS stored
     WHERE stored.organization_id = p_organization_id
     ORDER BY stored.site_id, stored.pool_id;
$$;

CREATE OR REPLACE FUNCTION organization.fn_italia_pool_chemistry_policy_upsert(
    p_organization_id VARCHAR,
    p_pool_id VARCHAR,
    p_site_id BIGINT,
    p_policy JSONB
)
RETURNS TABLE(policy JSONB)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_organization_id IS NULL OR p_organization_id = ''
       OR p_pool_id IS NULL OR p_pool_id = ''
       OR p_site_id < 1 OR p_policy IS NULL THEN
        RAISE EXCEPTION 'Italia pool policy identity and policy are required'
            USING ERRCODE = '22023';
    END IF;
    IF octet_length(p_policy::TEXT) > 65536 THEN
        RAISE EXCEPTION 'Italia pool policy exceeds 65536 bytes'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO organization.italia_pool_chemistry_policy AS stored (
        organization_id,
        pool_id,
        site_id,
        policy
    ) VALUES (
        p_organization_id,
        p_pool_id,
        p_site_id,
        p_policy
    )
    ON CONFLICT (organization_id, pool_id) DO UPDATE
       SET site_id = EXCLUDED.site_id,
           policy = EXCLUDED.policy,
           updated_at = NOW()
    RETURNING stored.policy INTO policy;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_italia_pool_chemistry_policy_delete(
    p_organization_id VARCHAR,
    p_pool_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH removed AS (
        DELETE FROM organization.italia_pool_chemistry_policy AS stored
         WHERE stored.organization_id = p_organization_id
           AND stored.pool_id = p_pool_id
         RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM removed);
$$;

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

CREATE OR REPLACE FUNCTION organization.fn_italia_pool_register_entry_delete(
    p_organization_id VARCHAR,
    p_site_id BIGINT,
    p_pool_id VARCHAR,
    p_register_date DATE,
    p_entry VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH removed AS (
        DELETE FROM organization.italia_pool_register_entry AS stored
         WHERE stored.organization_id = p_organization_id
           AND stored.site_id = p_site_id
           AND stored.pool_id = p_pool_id
           AND stored.register_date = p_register_date
           AND stored.entry = p_entry
         RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM removed);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_italia_pool_register_entry_delete(
    VARCHAR,
    BIGINT,
    VARCHAR,
    DATE,
    VARCHAR
);
DROP FUNCTION IF EXISTS organization.fn_italia_pool_register_entry_list(
    VARCHAR,
    BIGINT,
    VARCHAR,
    DATE,
    DATE
);
DROP FUNCTION IF EXISTS organization.fn_italia_pool_register_entry_upsert(
    VARCHAR,
    BIGINT,
    VARCHAR,
    DATE,
    VARCHAR,
    JSONB,
    VARCHAR
);
DROP FUNCTION IF EXISTS organization.fn_italia_pool_chemistry_policy_delete(
    VARCHAR,
    VARCHAR
);
DROP FUNCTION IF EXISTS organization.fn_italia_pool_chemistry_policy_upsert(
    VARCHAR,
    VARCHAR,
    BIGINT,
    JSONB
);
DROP FUNCTION IF EXISTS organization.fn_italia_pool_chemistry_policy_list(
    VARCHAR
);

-- Legal register evidence is retained on rollback for explicit operator recovery.
COMMENT ON TABLE organization.italia_pool_register_entry IS
    'Retained Italia pool-register evidence from migration 7381; no downgrade function mutates it.';
COMMENT ON TABLE organization.italia_pool_chemistry_policy IS
    'Retained Italia pool chemistry policy data from migration 7381.';
