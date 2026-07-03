--------------UP
-- Upsert live source config for a tariff. While the source stays push, the
-- token hash is preserved on updates that do not supply a new one. Switching to
-- pull clears it, so the old price-push URL stops working (no stale ingress).
CREATE OR REPLACE FUNCTION organization.fn_tariff_live_source_upsert(
    p_tariff_id       INT,
    p_mode            VARCHAR,
    p_provider        VARCHAR,
    p_push_token_hash VARCHAR,
    p_provider_config JSONB
) RETURNS void
LANGUAGE sql
AS $$
    INSERT INTO organization.tariff_live_source
        (tariff_id, mode, provider, push_token_hash, provider_config, updated)
    VALUES
        (p_tariff_id, p_mode, p_provider, p_push_token_hash, p_provider_config, CURRENT_TIMESTAMP)
    ON CONFLICT (tariff_id) DO UPDATE
        SET mode             = EXCLUDED.mode,
            provider         = EXCLUDED.provider,
            push_token_hash  = CASE
                WHEN EXCLUDED.mode = 'push'
                THEN COALESCE(EXCLUDED.push_token_hash, organization.tariff_live_source.push_token_hash)
                ELSE NULL
            END,
            provider_config  = EXCLUDED.provider_config,
            updated          = CURRENT_TIMESTAMP;
$$;

-- Look up a tariff_id by push token hash. Returns NULL when not found.
CREATE OR REPLACE FUNCTION organization.fn_tariff_live_source_by_token(
    p_token_hash VARCHAR
) RETURNS INTEGER
LANGUAGE sql STABLE
AS $$
    SELECT tariff_id
    FROM   organization.tariff_live_source
    WHERE  push_token_hash = p_token_hash;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_live_source_by_token(VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_tariff_live_source_upsert(INT, VARCHAR, VARCHAR, VARCHAR, JSONB);
