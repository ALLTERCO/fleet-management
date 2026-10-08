--------------UP
CREATE TABLE IF NOT EXISTS organization.gas_pricing_zone (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    zone_kind VARCHAR(64) NOT NULL,
    external_code VARCHAR(120) NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    day_boundary TIME NOT NULL,
    CONSTRAINT gas_pricing_zone_uq UNIQUE (
        organization_id, zone_kind, external_code
    ),
    CONSTRAINT gas_pricing_zone_org_uq UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS organization.gas_conversion_profile (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id VARCHAR(120) NOT NULL,
    device_id INTEGER NOT NULL,
    channel SMALLINT,
    pricing_zone_id BIGINT NOT NULL,
    metered_unit VARCHAR(16) NOT NULL,
    billed_unit VARCHAR(16) NOT NULL,
    volume_state VARCHAR(16) NOT NULL,
    correction_mode VARCHAR(32) NOT NULL,
    correction_factor NUMERIC(20, 10),
    metric_factor NUMERIC(20, 12),
    energy_divisor NUMERIC(20, 10) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    source_reference TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gas_conversion_profile_device_fk FOREIGN KEY (
        organization_id, device_id
    ) REFERENCES device.list (organization_id, id) ON DELETE CASCADE,
    CONSTRAINT gas_conversion_profile_zone_fk FOREIGN KEY (
        pricing_zone_id, organization_id
    ) REFERENCES organization.gas_pricing_zone (
        id, organization_id
    ) ON DELETE RESTRICT,
    CONSTRAINT gas_conversion_metered_unit_chk CHECK (
        metered_unit IN ('m3', 'ft3', 'ccf')
    ),
    CONSTRAINT gas_conversion_billed_unit_chk CHECK (
        billed_unit IN ('kWh', 'therm', 'MMBtu', 'GJ')
    ),
    CONSTRAINT gas_conversion_state_chk CHECK (
        volume_state IN ('corrected', 'uncorrected')
    ),
    CONSTRAINT gas_conversion_mode_chk CHECK (correction_mode IN (
        'none', 'statutory_constant', 'altitude_formula',
        'zone_table', 'computed_PZ', 'computed_TPZ'
    )),
    CONSTRAINT gas_conversion_correction_chk CHECK (
        (volume_state = 'corrected' AND correction_mode = 'none'
            AND correction_factor IS NULL)
        OR
        (volume_state = 'uncorrected' AND correction_mode <> 'none'
            AND correction_factor > 0)
    ),
    CONSTRAINT gas_conversion_metric_chk CHECK (
        (metered_unit = 'm3' AND metric_factor IS NULL)
        OR (metered_unit <> 'm3' AND metric_factor > 0)
    ),
    CONSTRAINT gas_conversion_divisor_chk CHECK (energy_divisor > 0),
    CONSTRAINT gas_conversion_period_chk CHECK (
        effective_to IS NULL OR effective_to > effective_from
    ),
    CONSTRAINT gas_conversion_revision_chk CHECK (revision > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS gas_conversion_version_uq
    ON organization.gas_conversion_profile (
        organization_id, device_id, channel, effective_from, revision
    ) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS gas_conversion_profile_resolve_idx
    ON organization.gas_conversion_profile (
        organization_id, device_id, channel, effective_from, revision DESC
    );

CREATE TABLE IF NOT EXISTS organization.gas_calorific_value (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    pricing_zone_id BIGINT NOT NULL,
    gas_day DATE NOT NULL,
    value NUMERIC(20, 10) NOT NULL,
    unit VARCHAR(16) NOT NULL,
    weighting VARCHAR(16) NOT NULL,
    rounding_rule VARCHAR(24) NOT NULL,
    revision INTEGER NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    source_reference TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gas_cv_zone_fk FOREIGN KEY (
        pricing_zone_id, organization_id
    ) REFERENCES organization.gas_pricing_zone (
        id, organization_id
    ) ON DELETE CASCADE,
    CONSTRAINT gas_cv_value_chk CHECK (value > 0),
    CONSTRAINT gas_cv_unit_chk CHECK (unit IN ('MJ/m3', 'kWh/m3')),
    CONSTRAINT gas_cv_weighting_chk CHECK (weighting IN ('none', 'quantity')),
    CONSTRAINT gas_cv_rounding_chk CHECK (
        rounding_rule IN ('none', 'truncate_0_1')
    ),
    CONSTRAINT gas_cv_revision_chk CHECK (revision > 0),
    CONSTRAINT gas_cv_version_uq UNIQUE (
        organization_id, pricing_zone_id, gas_day, revision
    )
);

CREATE INDEX IF NOT EXISTS gas_calorific_value_resolve_idx
    ON organization.gas_calorific_value (
        organization_id, pricing_zone_id, gas_day, revision DESC
    );

CREATE TABLE IF NOT EXISTS organization.gas_conversion_archive_7362 (
    kind VARCHAR(16) NOT NULL,
    organization_id VARCHAR(120) NOT NULL,
    row_id BIGINT NOT NULL,
    payload JSONB NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, organization_id, row_id)
);

INSERT INTO organization.gas_pricing_zone OVERRIDING SYSTEM VALUE
SELECT (restored).*
  FROM organization.gas_conversion_archive_7362 archive
 CROSS JOIN LATERAL jsonb_populate_record(
    NULL::organization.gas_pricing_zone, archive.payload
 ) restored
 WHERE archive.kind = 'zone'
ON CONFLICT DO NOTHING;

INSERT INTO organization.gas_conversion_profile OVERRIDING SYSTEM VALUE
SELECT (restored).*
  FROM organization.gas_conversion_archive_7362 archive
 CROSS JOIN LATERAL jsonb_populate_record(
    NULL::organization.gas_conversion_profile, archive.payload
 ) restored
 WHERE archive.kind = 'profile'
ON CONFLICT DO NOTHING;

INSERT INTO organization.gas_calorific_value OVERRIDING SYSTEM VALUE
SELECT (restored).*
  FROM organization.gas_conversion_archive_7362 archive
 CROSS JOIN LATERAL jsonb_populate_record(
    NULL::organization.gas_calorific_value, archive.payload
 ) restored
 WHERE archive.kind = 'calorific_value'
ON CONFLICT DO NOTHING;

-- Restored identity values must advance their sequences. Otherwise the first
-- post-rollback insert can collide with a restored id.
SELECT setval(
    pg_get_serial_sequence('organization.gas_pricing_zone', 'id'),
    COALESCE((SELECT MAX(id) FROM organization.gas_pricing_zone), 1),
    EXISTS (SELECT 1 FROM organization.gas_pricing_zone)
);
SELECT setval(
    pg_get_serial_sequence('organization.gas_conversion_profile', 'id'),
    COALESCE((SELECT MAX(id) FROM organization.gas_conversion_profile), 1),
    EXISTS (SELECT 1 FROM organization.gas_conversion_profile)
);
SELECT setval(
    pg_get_serial_sequence('organization.gas_calorific_value', 'id'),
    COALESCE((SELECT MAX(id) FROM organization.gas_calorific_value), 1),
    EXISTS (SELECT 1 FROM organization.gas_calorific_value)
);

DELETE FROM organization.gas_conversion_archive_7362 archive
 WHERE (archive.kind = 'zone' AND EXISTS (
    SELECT 1 FROM organization.gas_pricing_zone row WHERE row.id = archive.row_id
 )) OR (archive.kind = 'profile' AND EXISTS (
    SELECT 1 FROM organization.gas_conversion_profile row WHERE row.id = archive.row_id
 )) OR (archive.kind = 'calorific_value' AND EXISTS (
    SELECT 1 FROM organization.gas_calorific_value row WHERE row.id = archive.row_id
 ));

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

CREATE OR REPLACE FUNCTION organization.fn_gas_pricing_zone_upsert(
    p_org VARCHAR,
    p_payload JSONB
)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO organization.gas_pricing_zone (
        organization_id, name, zone_kind, external_code, timezone, day_boundary
    ) VALUES (
        p_org, p_payload->>'name', p_payload->>'zoneKind',
        p_payload->>'externalCode', p_payload->>'timezone',
        (p_payload->>'dayBoundary')::TIME
    ) ON CONFLICT (organization_id, zone_kind, external_code) DO UPDATE SET
        name = EXCLUDED.name,
        timezone = EXCLUDED.timezone,
        day_boundary = EXCLUDED.day_boundary
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

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

CREATE OR REPLACE FUNCTION organization.fn_gas_calorific_value_add(
    p_org VARCHAR,
    p_payload JSONB
)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO organization.gas_calorific_value (
        organization_id, pricing_zone_id, gas_day, value, unit, weighting,
        rounding_rule, revision, published_at, source_reference
    ) VALUES (
        p_org, (p_payload->>'pricingZoneId')::BIGINT,
        (p_payload->>'gasDay')::DATE, (p_payload->>'value')::NUMERIC,
        p_payload->>'unit', p_payload->>'weighting',
        p_payload->>'roundingRule', (p_payload->>'revision')::INTEGER,
        (p_payload->>'publishedAt')::TIMESTAMPTZ,
        p_payload->>'sourceReference'
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

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

--------------DOWN
INSERT INTO organization.gas_conversion_archive_7362 (
    kind, organization_id, row_id, payload
)
SELECT 'calorific_value', organization_id, id, to_jsonb(value)
  FROM organization.gas_calorific_value value
ON CONFLICT (kind, organization_id, row_id) DO UPDATE SET
    payload = EXCLUDED.payload, archived_at = now();

INSERT INTO organization.gas_conversion_archive_7362 (
    kind, organization_id, row_id, payload
)
SELECT 'profile', organization_id, id, to_jsonb(profile)
  FROM organization.gas_conversion_profile profile
ON CONFLICT (kind, organization_id, row_id) DO UPDATE SET
    payload = EXCLUDED.payload, archived_at = now();

INSERT INTO organization.gas_conversion_archive_7362 (
    kind, organization_id, row_id, payload
)
SELECT 'zone', organization_id, id, to_jsonb(zone)
  FROM organization.gas_pricing_zone zone
ON CONFLICT (kind, organization_id, row_id) DO UPDATE SET
    payload = EXCLUDED.payload, archived_at = now();

-- LINT-IGNORE: additive-only -- conversion configuration is intentionally removed on rollback.
DROP FUNCTION IF EXISTS organization.fn_gas_calorific_value_resolve(VARCHAR, BIGINT, DATE, DATE);
-- LINT-IGNORE: additive-only -- conversion configuration is intentionally removed on rollback.
DROP FUNCTION IF EXISTS organization.fn_gas_calorific_value_add(VARCHAR, JSONB);
-- LINT-IGNORE: additive-only -- conversion configuration is intentionally removed on rollback.
DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_list(VARCHAR, VARCHAR, SMALLINT, DATE, DATE);
-- LINT-IGNORE: additive-only -- conversion configuration is intentionally removed on rollback.
DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_resolve(VARCHAR, VARCHAR, SMALLINT, DATE, DATE);
-- LINT-IGNORE: additive-only -- conversion configuration is intentionally removed on rollback.
DROP FUNCTION IF EXISTS organization.fn_gas_conversion_profile_upsert(VARCHAR, JSONB);
-- LINT-IGNORE: additive-only -- conversion configuration is intentionally removed on rollback.
DROP FUNCTION IF EXISTS organization.fn_gas_pricing_zone_upsert(VARCHAR, JSONB);
-- LINT-IGNORE: additive-only -- append-only values must be exported before rollback.
DROP TABLE IF EXISTS organization.gas_calorific_value;
-- LINT-IGNORE: additive-only -- profiles must be exported before rollback.
DROP TABLE IF EXISTS organization.gas_conversion_profile;
-- LINT-IGNORE: additive-only -- zones must be exported before rollback.
DROP TABLE IF EXISTS organization.gas_pricing_zone;
