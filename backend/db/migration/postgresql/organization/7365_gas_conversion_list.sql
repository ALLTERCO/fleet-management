--------------UP
-- Bounded tenant-scoped reads for the first-party gas conversion admin UI.
CREATE OR REPLACE FUNCTION organization.fn_gas_pricing_zone_list(
    p_org VARCHAR,
    p_limit INTEGER DEFAULT 100,
    p_before_id BIGINT DEFAULT NULL
)
RETURNS SETOF organization.gas_pricing_zone
LANGUAGE sql STABLE
AS $$
    SELECT zone.*
      FROM organization.gas_pricing_zone zone
     WHERE zone.organization_id = p_org
       AND (p_before_id IS NULL OR zone.id < p_before_id)
     ORDER BY zone.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 101));
$$;

CREATE OR REPLACE FUNCTION organization.fn_gas_conversion_profile_admin_list(
    p_org VARCHAR,
    p_device_external_id VARCHAR DEFAULT NULL,
    p_channel SMALLINT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_before_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT, device_external_id VARCHAR, channel SMALLINT,
    pricing_zone_id BIGINT, metered_unit VARCHAR, billed_unit VARCHAR,
    volume_state VARCHAR, correction_mode VARCHAR, correction_factor NUMERIC,
    metric_factor NUMERIC, energy_divisor NUMERIC, effective_from DATE,
    effective_to DATE, source_reference TEXT, revision INTEGER,
    created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT profile.id, device.external_id, profile.channel,
           profile.pricing_zone_id, profile.metered_unit, profile.billed_unit,
           profile.volume_state, profile.correction_mode,
           profile.correction_factor, profile.metric_factor,
           profile.energy_divisor, profile.effective_from,
           profile.effective_to, profile.source_reference, profile.revision,
           profile.created_at
      FROM organization.gas_conversion_profile profile
      JOIN device.list device
        ON device.organization_id = profile.organization_id
       AND device.id = profile.device_id
     WHERE profile.organization_id = p_org
       AND (p_device_external_id IS NULL
            OR device.external_id = p_device_external_id)
       AND (p_channel IS NULL OR profile.channel IS NOT DISTINCT FROM p_channel)
       AND (p_before_id IS NULL OR profile.id < p_before_id)
     ORDER BY profile.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 101));
$$;

CREATE OR REPLACE FUNCTION organization.fn_gas_calorific_value_list(
    p_org VARCHAR,
    p_pricing_zone_id BIGINT DEFAULT NULL,
    p_gas_day_from DATE DEFAULT NULL,
    p_gas_day_to DATE DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_before_id BIGINT DEFAULT NULL
)
RETURNS SETOF organization.gas_calorific_value
LANGUAGE sql STABLE
AS $$
    SELECT value.*
      FROM organization.gas_calorific_value value
     WHERE value.organization_id = p_org
       AND (p_pricing_zone_id IS NULL
            OR value.pricing_zone_id = p_pricing_zone_id)
       AND (p_gas_day_from IS NULL OR value.gas_day >= p_gas_day_from)
       AND (p_gas_day_to IS NULL OR value.gas_day <= p_gas_day_to)
       AND (p_before_id IS NULL OR value.id < p_before_id)
     ORDER BY value.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 101));
$$;

--------------DOWN
-- LINT-IGNORE: additive-only -- bounded read API is removed with this version.
DROP FUNCTION IF EXISTS organization.fn_gas_calorific_value_list(VARCHAR, BIGINT, DATE, DATE, INTEGER, BIGINT);
-- LINT-IGNORE: additive-only -- bounded read API is removed with this version.
DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_admin_list(VARCHAR, VARCHAR, SMALLINT, INTEGER, BIGINT);
-- LINT-IGNORE: additive-only -- bounded read API is removed with this version.
DROP FUNCTION IF EXISTS organization.fn_gas_pricing_zone_list(VARCHAR, INTEGER, BIGINT);
