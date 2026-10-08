--------------UP
-- Calendar dates return as 'YYYY-MM-DD' text so no driver or host time zone shifts them.
DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_resolve(VARCHAR, VARCHAR, SMALLINT, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_gas_conversion_profile_resolve(
    p_org VARCHAR,
    p_device_external_id VARCHAR,
    p_channel SMALLINT,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE (
    id BIGINT, pricing_zone_id BIGINT, metered_unit VARCHAR,
    billed_unit VARCHAR, volume_state VARCHAR, correction_mode VARCHAR,
    correction_factor NUMERIC, metric_factor NUMERIC, energy_divisor NUMERIC,
    effective_from TEXT, effective_to TEXT, source_reference TEXT,
    revision INTEGER, timezone VARCHAR, day_boundary TIME
) LANGUAGE sql STABLE AS $$
    SELECT profile.id, profile.pricing_zone_id, profile.metered_unit,
           profile.billed_unit, profile.volume_state, profile.correction_mode,
           profile.correction_factor, profile.metric_factor,
           profile.energy_divisor,
           to_char(profile.effective_from, 'YYYY-MM-DD'),
           to_char(profile.effective_to, 'YYYY-MM-DD'),
           profile.source_reference, profile.revision,
           zone.timezone, zone.day_boundary
      FROM organization.gas_conversion_profile profile
      JOIN device.list device
        ON device.organization_id = profile.organization_id
       AND device.id = profile.device_id
      JOIN organization.gas_pricing_zone zone
        ON zone.id = profile.pricing_zone_id
     WHERE profile.organization_id = p_org
       AND device.external_id = p_device_external_id
       AND profile.channel IS NOT DISTINCT FROM p_channel
       AND profile.effective_from <= p_from
       AND (profile.effective_to IS NULL OR profile.effective_to > p_to)
     ORDER BY profile.revision DESC, profile.created_at DESC
     LIMIT 1;
$$;

DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_list(VARCHAR, VARCHAR, SMALLINT, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_gas_conversion_profile_list(
    p_org VARCHAR,
    p_device_external_id VARCHAR,
    p_channel SMALLINT,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE (
    id BIGINT, pricing_zone_id BIGINT, metered_unit VARCHAR,
    billed_unit VARCHAR, volume_state VARCHAR, correction_mode VARCHAR,
    correction_factor NUMERIC, metric_factor NUMERIC, energy_divisor NUMERIC,
    effective_from TEXT, effective_to TEXT, source_reference TEXT,
    revision INTEGER, timezone VARCHAR, day_boundary TIME
) LANGUAGE sql STABLE AS $$
    SELECT profile.id, profile.pricing_zone_id, profile.metered_unit,
           profile.billed_unit, profile.volume_state, profile.correction_mode,
           profile.correction_factor, profile.metric_factor,
           profile.energy_divisor,
           to_char(profile.effective_from, 'YYYY-MM-DD'),
           to_char(profile.effective_to, 'YYYY-MM-DD'),
           profile.source_reference, profile.revision,
           zone.timezone, zone.day_boundary
      FROM organization.gas_conversion_profile profile
      JOIN device.list device
        ON device.organization_id = profile.organization_id
       AND device.id = profile.device_id
      JOIN organization.gas_pricing_zone zone
        ON zone.id = profile.pricing_zone_id
       AND zone.organization_id = profile.organization_id
     WHERE profile.organization_id = p_org
       AND device.external_id = p_device_external_id
       AND profile.channel IS NOT DISTINCT FROM p_channel
       AND profile.effective_from <= p_to
       AND (profile.effective_to IS NULL OR profile.effective_to > p_from)
     ORDER BY profile.effective_from, profile.revision DESC,
              profile.created_at DESC;
$$;

DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_admin_list(VARCHAR, VARCHAR, SMALLINT, INTEGER, BIGINT);
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
    metric_factor NUMERIC, energy_divisor NUMERIC, effective_from TEXT,
    effective_to TEXT, source_reference TEXT, revision INTEGER,
    created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT profile.id, device.external_id, profile.channel,
           profile.pricing_zone_id, profile.metered_unit, profile.billed_unit,
           profile.volume_state, profile.correction_mode,
           profile.correction_factor, profile.metric_factor,
           profile.energy_divisor,
           to_char(profile.effective_from, 'YYYY-MM-DD'),
           to_char(profile.effective_to, 'YYYY-MM-DD'),
           profile.source_reference, profile.revision,
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

DROP FUNCTION IF EXISTS organization.fn_gas_calorific_value_list(VARCHAR, BIGINT, DATE, DATE, INTEGER, BIGINT);
CREATE OR REPLACE FUNCTION organization.fn_gas_calorific_value_list(
    p_org VARCHAR,
    p_pricing_zone_id BIGINT DEFAULT NULL,
    p_gas_day_from DATE DEFAULT NULL,
    p_gas_day_to DATE DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_before_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT, organization_id VARCHAR, pricing_zone_id BIGINT,
    gas_day TEXT, value NUMERIC, unit VARCHAR, weighting VARCHAR,
    rounding_rule VARCHAR, revision INTEGER, published_at TIMESTAMPTZ,
    source_reference TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT cv.id, cv.organization_id, cv.pricing_zone_id,
           to_char(cv.gas_day, 'YYYY-MM-DD'), cv.value, cv.unit,
           cv.weighting, cv.rounding_rule, cv.revision, cv.published_at,
           cv.source_reference, cv.created_at
      FROM organization.gas_calorific_value cv
     WHERE cv.organization_id = p_org
       AND (p_pricing_zone_id IS NULL
            OR cv.pricing_zone_id = p_pricing_zone_id)
       AND (p_gas_day_from IS NULL OR cv.gas_day >= p_gas_day_from)
       AND (p_gas_day_to IS NULL OR cv.gas_day <= p_gas_day_to)
       AND (p_before_id IS NULL OR cv.id < p_before_id)
     ORDER BY cv.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 101));
$$;

DROP FUNCTION IF EXISTS organization.fn_gas_calorific_value_resolve(VARCHAR, BIGINT, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_gas_calorific_value_resolve(
    p_org VARCHAR,
    p_zone BIGINT,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE (
    id BIGINT, organization_id VARCHAR, pricing_zone_id BIGINT,
    gas_day TEXT, value NUMERIC, unit VARCHAR, weighting VARCHAR,
    rounding_rule VARCHAR, revision INTEGER, published_at TIMESTAMPTZ,
    source_reference TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (cv.gas_day)
           cv.id, cv.organization_id, cv.pricing_zone_id,
           to_char(cv.gas_day, 'YYYY-MM-DD'), cv.value, cv.unit,
           cv.weighting, cv.rounding_rule, cv.revision, cv.published_at,
           cv.source_reference, cv.created_at
      FROM organization.gas_calorific_value cv
     WHERE cv.organization_id = p_org
       AND cv.pricing_zone_id = p_zone
       AND cv.gas_day BETWEEN p_from AND p_to
     ORDER BY cv.gas_day, cv.revision DESC, cv.published_at DESC;
$$;

--------------DOWN
-- Restore the DATE-returning reads from 7362 and 7365.
DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_resolve(VARCHAR, VARCHAR, SMALLINT, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_gas_conversion_profile_resolve(
    p_org VARCHAR,
    p_device_external_id VARCHAR,
    p_channel SMALLINT,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE (
    id BIGINT, pricing_zone_id BIGINT, metered_unit VARCHAR,
    billed_unit VARCHAR, volume_state VARCHAR, correction_mode VARCHAR,
    correction_factor NUMERIC, metric_factor NUMERIC, energy_divisor NUMERIC,
    effective_from DATE, effective_to DATE, source_reference TEXT,
    revision INTEGER, timezone VARCHAR, day_boundary TIME
) LANGUAGE sql STABLE AS $$
    SELECT profile.id, profile.pricing_zone_id, profile.metered_unit,
           profile.billed_unit, profile.volume_state, profile.correction_mode,
           profile.correction_factor, profile.metric_factor,
           profile.energy_divisor, profile.effective_from,
           profile.effective_to, profile.source_reference, profile.revision,
           zone.timezone, zone.day_boundary
      FROM organization.gas_conversion_profile profile
      JOIN device.list device
        ON device.organization_id = profile.organization_id
       AND device.id = profile.device_id
      JOIN organization.gas_pricing_zone zone
        ON zone.id = profile.pricing_zone_id
     WHERE profile.organization_id = p_org
       AND device.external_id = p_device_external_id
       AND profile.channel IS NOT DISTINCT FROM p_channel
       AND profile.effective_from <= p_from
       AND (profile.effective_to IS NULL OR profile.effective_to > p_to)
     ORDER BY profile.revision DESC, profile.created_at DESC
     LIMIT 1;
$$;

DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_list(VARCHAR, VARCHAR, SMALLINT, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_gas_conversion_profile_list(
    p_org VARCHAR,
    p_device_external_id VARCHAR,
    p_channel SMALLINT,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE (
    id BIGINT, pricing_zone_id BIGINT, metered_unit VARCHAR,
    billed_unit VARCHAR, volume_state VARCHAR, correction_mode VARCHAR,
    correction_factor NUMERIC, metric_factor NUMERIC, energy_divisor NUMERIC,
    effective_from DATE, effective_to DATE, source_reference TEXT,
    revision INTEGER, timezone VARCHAR, day_boundary TIME
) LANGUAGE sql STABLE AS $$
    SELECT profile.id, profile.pricing_zone_id, profile.metered_unit,
           profile.billed_unit, profile.volume_state, profile.correction_mode,
           profile.correction_factor, profile.metric_factor,
           profile.energy_divisor, profile.effective_from,
           profile.effective_to, profile.source_reference, profile.revision,
           zone.timezone, zone.day_boundary
      FROM organization.gas_conversion_profile profile
      JOIN device.list device
        ON device.organization_id = profile.organization_id
       AND device.id = profile.device_id
      JOIN organization.gas_pricing_zone zone
        ON zone.id = profile.pricing_zone_id
       AND zone.organization_id = profile.organization_id
     WHERE profile.organization_id = p_org
       AND device.external_id = p_device_external_id
       AND profile.channel IS NOT DISTINCT FROM p_channel
       AND profile.effective_from <= p_to
       AND (profile.effective_to IS NULL OR profile.effective_to > p_from)
     ORDER BY profile.effective_from, profile.revision DESC,
              profile.created_at DESC;
$$;

DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_admin_list(VARCHAR, VARCHAR, SMALLINT, INTEGER, BIGINT);
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

DROP FUNCTION IF EXISTS organization.fn_gas_calorific_value_list(VARCHAR, BIGINT, DATE, DATE, INTEGER, BIGINT);
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

DROP FUNCTION IF EXISTS organization.fn_gas_calorific_value_resolve(VARCHAR, BIGINT, DATE, DATE);
CREATE OR REPLACE FUNCTION organization.fn_gas_calorific_value_resolve(
    p_org VARCHAR,
    p_zone BIGINT,
    p_from DATE,
    p_to DATE
)
RETURNS SETOF organization.gas_calorific_value
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (gas_day) value.*
      FROM organization.gas_calorific_value value
     WHERE value.organization_id = p_org
       AND value.pricing_zone_id = p_zone
       AND value.gas_day BETWEEN p_from AND p_to
     ORDER BY gas_day, revision DESC, published_at DESC;
$$;
