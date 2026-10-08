--------------UP
-- One billed unit is this many megajoules. A physical definition of the unit
-- itself, not a setting: nobody gets to tune what a therm is.
CREATE OR REPLACE FUNCTION organization.fn_gas_mj_per_billed_unit(
    p_unit VARCHAR
)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_unit
        WHEN 'kWh' THEN 3.6
        WHEN 'therm' THEN 105.505
        WHEN 'MMBtu' THEN 1055.06
        WHEN 'GJ' THEN 1000
    END::NUMERIC;
$$;

-- One metered unit is this many cubic metres, a physical definition too. A m3
-- meter needs no conversion, so it has no figure.
CREATE OR REPLACE FUNCTION organization.fn_gas_m3_per_metered_unit(
    p_unit VARCHAR
)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_unit
        WHEN 'ft3' THEN 0.0283168
        WHEN 'ccf' THEN 2.83168
    END::NUMERIC;
$$;

-- A supplier may genuinely publish a different figure. This column is how a
-- row says the mismatch is deliberate, so a wrong number carries a name
-- instead of slipping through.
ALTER TABLE organization.gas_conversion_profile
    ADD COLUMN IF NOT EXISTS unit_override_reason TEXT;

DO $$
BEGIN
    -- A blank reason excuses nothing.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'organization.gas_conversion_profile'::regclass
           AND conname = 'gas_conversion_unit_override_reason_chk'
    ) THEN
        ALTER TABLE organization.gas_conversion_profile
            ADD CONSTRAINT gas_conversion_unit_override_reason_chk CHECK (
                unit_override_reason IS NULL OR (
                    unit_override_reason = btrim(unit_override_reason)
                    AND unit_override_reason <> ''
                )
            );
    END IF;
    -- The divisor must be the figure the billed unit implies, and the metric
    -- factor the figure the metered unit implies. therm billed on the kWh
    -- divisor bills 29 times too much, and only this table sees every writer.
    --
    -- Tolerance is 1% of the defined figure: a supplier may publish it
    -- rounded, and exact NUMERIC equality is brittle. It is the same line the
    -- profile form draws, and far tighter than any unit confusion, the
    -- closest of which is 29x out.
    --
    -- Whether a m3 meter may carry a metric factor at all is
    -- gas_conversion_metric_chk's rule, from 7362. This one only judges the
    -- figure, and stands aside for the units that have none.
    --
    -- NOT VALID: rows written before this rule existed are left unchecked, so
    -- the migration cannot fail on shipped data. Every insert and update from
    -- here on is checked; the unchecked legacy rows are reported separately.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'organization.gas_conversion_profile'::regclass
           AND conname = 'gas_conversion_unit_definition_chk'
    ) THEN
        ALTER TABLE organization.gas_conversion_profile
            ADD CONSTRAINT gas_conversion_unit_definition_chk CHECK (
                unit_override_reason IS NOT NULL
                OR (
                    organization.fn_gas_mj_per_billed_unit(billed_unit)
                        IS NOT NULL
                    AND abs(
                        energy_divisor
                        - organization.fn_gas_mj_per_billed_unit(billed_unit)
                    ) <= organization.fn_gas_mj_per_billed_unit(billed_unit)
                        * 0.01
                    AND (
                        organization.fn_gas_m3_per_metered_unit(metered_unit)
                            IS NULL
                        OR abs(
                            metric_factor
                            - organization.fn_gas_m3_per_metered_unit(
                                metered_unit
                            )
                        ) <= organization.fn_gas_m3_per_metered_unit(
                            metered_unit
                        ) * 0.01
                    )
                )
            ) NOT VALID;
    END IF;
END;
$$;

-- The service writes profiles through this function alone, so the escape
-- hatch is unreachable until the function carries it. Same signature and same
-- revision arithmetic as 7362; only the new column is added.
CREATE OR REPLACE FUNCTION organization.fn_gas_conversion_profile_upsert(
    p_org VARCHAR,
    p_payload JSONB
)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    v_id BIGINT;
    v_device INTEGER;
    v_revision INTEGER;
BEGIN
    v_device := organization.fn_resolve_device_id(
        p_org, p_payload->>'deviceExternalId'
    );
    SELECT COALESCE(
        (p_payload->>'revision')::INTEGER,
        MAX(profile.revision) + 1,
        1
    )
      INTO v_revision
      FROM organization.gas_conversion_profile profile
     WHERE profile.organization_id = p_org
       AND profile.device_id = v_device
       AND profile.channel IS NOT DISTINCT FROM
           (p_payload->>'channel')::SMALLINT
       AND profile.effective_from = (p_payload->>'effectiveFrom')::DATE;
    INSERT INTO organization.gas_conversion_profile (
        organization_id, device_id, channel, pricing_zone_id,
        metered_unit, billed_unit, volume_state, correction_mode,
        correction_factor, metric_factor, energy_divisor,
        effective_from, effective_to, source_reference, revision,
        unit_override_reason
    ) VALUES (
        p_org, v_device, (p_payload->>'channel')::SMALLINT,
        (p_payload->>'pricingZoneId')::BIGINT,
        p_payload->>'meteredUnit', p_payload->>'billedUnit',
        p_payload->>'volumeState', p_payload->>'correctionMode',
        (p_payload->>'correctionFactor')::NUMERIC,
        (p_payload->>'metricFactor')::NUMERIC,
        (p_payload->>'energyDivisor')::NUMERIC,
        (p_payload->>'effectiveFrom')::DATE,
        NULLIF(p_payload->>'effectiveTo', '')::DATE,
        p_payload->>'sourceReference', v_revision,
        p_payload->>'unitOverrideReason'
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

--------------DOWN
-- The stated reason is the only record of why a supplier figure is deliberate,
-- and dropping the column deletes it silently. Stop the rollback instead.
DO $$
DECLARE v_stated BIGINT;
BEGIN
    SELECT count(*) INTO v_stated
      FROM organization.gas_conversion_profile
     WHERE unit_override_reason IS NOT NULL;
    IF v_stated > 0 THEN
        RAISE EXCEPTION
            'rollback would delete % stated gas unit override reason(s). Export organization.gas_conversion_profile.unit_override_reason, then correct those rows to the figures their units define, or delete them. Clearing the reason on its own is refused by gas_conversion_unit_definition_chk.',
            v_stated;
    END IF;
END;
$$;

ALTER TABLE organization.gas_conversion_profile
    DROP CONSTRAINT IF EXISTS gas_conversion_unit_definition_chk,
    DROP CONSTRAINT IF EXISTS gas_conversion_unit_override_reason_chk,
    DROP COLUMN IF EXISTS unit_override_reason;

-- 7362's definition verbatim: the column is gone, so the write path may not
-- name it.
CREATE OR REPLACE FUNCTION organization.fn_gas_conversion_profile_upsert(
    p_org VARCHAR,
    p_payload JSONB
)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    v_id BIGINT;
    v_device INTEGER;
    v_revision INTEGER;
BEGIN
    v_device := organization.fn_resolve_device_id(
        p_org, p_payload->>'deviceExternalId'
    );
    SELECT COALESCE(
        (p_payload->>'revision')::INTEGER,
        MAX(profile.revision) + 1,
        1
    )
      INTO v_revision
      FROM organization.gas_conversion_profile profile
     WHERE profile.organization_id = p_org
       AND profile.device_id = v_device
       AND profile.channel IS NOT DISTINCT FROM
           (p_payload->>'channel')::SMALLINT
       AND profile.effective_from = (p_payload->>'effectiveFrom')::DATE;
    INSERT INTO organization.gas_conversion_profile (
        organization_id, device_id, channel, pricing_zone_id,
        metered_unit, billed_unit, volume_state, correction_mode,
        correction_factor, metric_factor, energy_divisor,
        effective_from, effective_to, source_reference, revision
    ) VALUES (
        p_org, v_device, (p_payload->>'channel')::SMALLINT,
        (p_payload->>'pricingZoneId')::BIGINT,
        p_payload->>'meteredUnit', p_payload->>'billedUnit',
        p_payload->>'volumeState', p_payload->>'correctionMode',
        (p_payload->>'correctionFactor')::NUMERIC,
        (p_payload->>'metricFactor')::NUMERIC,
        (p_payload->>'energyDivisor')::NUMERIC,
        (p_payload->>'effectiveFrom')::DATE,
        NULLIF(p_payload->>'effectiveTo', '')::DATE,
        p_payload->>'sourceReference', v_revision
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS organization.fn_gas_m3_per_metered_unit(VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_gas_mj_per_billed_unit(VARCHAR);
