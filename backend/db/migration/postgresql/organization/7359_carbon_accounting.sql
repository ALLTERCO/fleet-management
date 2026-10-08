--------------UP
-- Carbon accounting is deliberately separate from utility tariffs. Emission
-- factors convert physical activity to CO2e; carbon prices value that result.

CREATE TABLE IF NOT EXISTS organization.emission_factor (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id       VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    commodity             VARCHAR(48) NOT NULL,
    billed_unit           VARCHAR(24) NOT NULL,
    region                VARCHAR(120) NOT NULL,
    accounting_basis      VARCHAR(24) NOT NULL,
    emissions_scope       VARCHAR(16) NOT NULL,
    factor_kg_per_unit    NUMERIC(20, 9) NOT NULL,
    effective_from        TIMESTAMPTZ NOT NULL,
    effective_to          TIMESTAMPTZ NULL,
    source_reference      TEXT NOT NULL,
    revision              INTEGER NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT emission_factor_basis_chk CHECK (
        accounting_basis IN ('location_based', 'market_based', 'direct')
    ),
    CONSTRAINT emission_factor_scope_chk CHECK (
        emissions_scope IN ('scope1', 'scope2', 'scope3')
    ),
    CONSTRAINT emission_factor_basis_scope_chk CHECK (
        (accounting_basis IN ('location_based', 'market_based')
            AND emissions_scope = 'scope2')
        OR (accounting_basis = 'direct' AND emissions_scope <> 'scope2')
    ),
    CONSTRAINT emission_factor_value_chk CHECK (factor_kg_per_unit >= 0),
    CONSTRAINT emission_factor_revision_chk CHECK (revision > 0),
    CONSTRAINT emission_factor_period_chk CHECK (
        effective_to IS NULL OR effective_to > effective_from
    ),
    CONSTRAINT emission_factor_version_uq UNIQUE (
        organization_id, commodity, billed_unit, region, accounting_basis,
        emissions_scope, effective_from, source_reference, revision
    )
);

CREATE INDEX IF NOT EXISTS emission_factor_resolve_idx
    ON organization.emission_factor (
        organization_id, commodity, billed_unit, region, accounting_basis,
        effective_from, revision DESC
    );

CREATE TABLE IF NOT EXISTS organization.carbon_price (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id       VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    name                  VARCHAR(128) NOT NULL,
    price_type            VARCHAR(16) NOT NULL,
    applies_to_scope      VARCHAR(16) NOT NULL,
    currency              VARCHAR(3) NOT NULL,
    amount_per_tonne      NUMERIC(20, 6) NOT NULL,
    effective_from        TIMESTAMPTZ NOT NULL,
    effective_to          TIMESTAMPTZ NULL,
    source_reference      TEXT NOT NULL,
    revision              INTEGER NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT carbon_price_type_chk CHECK (
        price_type IN ('shadow', 'fee', 'implicit', 'regulated')
    ),
    CONSTRAINT carbon_price_scope_chk CHECK (
        applies_to_scope IN ('scope1', 'scope2', 'scope3', 'all')
    ),
    CONSTRAINT carbon_price_currency_chk CHECK (
        currency ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT carbon_price_amount_chk CHECK (amount_per_tonne >= 0),
    CONSTRAINT carbon_price_revision_chk CHECK (revision > 0),
    CONSTRAINT carbon_price_period_chk CHECK (
        effective_to IS NULL OR effective_to > effective_from
    ),
    CONSTRAINT carbon_price_version_uq UNIQUE (
        organization_id, name, price_type, applies_to_scope,
        effective_from, source_reference, revision
    )
);

CREATE INDEX IF NOT EXISTS carbon_price_resolve_idx
    ON organization.carbon_price (
        organization_id, applies_to_scope, effective_from, revision DESC
    );

-- This archive intentionally survives DOWN so a later UP can restore every
-- organization that still exists. Rows for deleted organizations remain in
-- the archive for operator-directed recovery instead of breaking migration.
CREATE TABLE IF NOT EXISTS organization.carbon_accounting_archive_7359 (
    kind                  VARCHAR(32) NOT NULL,
    organization_id       VARCHAR(120) NOT NULL,
    row_id                BIGINT NOT NULL,
    payload               JSONB NOT NULL,
    archived_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, organization_id, row_id),
    CONSTRAINT carbon_accounting_archive_kind_chk CHECK (
        kind IN ('emission_factor', 'carbon_price')
    )
);

INSERT INTO organization.emission_factor OVERRIDING SYSTEM VALUE
SELECT (restored).*
  FROM organization.carbon_accounting_archive_7359 archive
  JOIN organization.profile profile ON profile.id = archive.organization_id
 CROSS JOIN LATERAL jsonb_populate_record(
    NULL::organization.emission_factor, archive.payload
 ) restored
 WHERE archive.kind = 'emission_factor'
ON CONFLICT DO NOTHING;

INSERT INTO organization.carbon_price OVERRIDING SYSTEM VALUE
SELECT (restored).*
  FROM organization.carbon_accounting_archive_7359 archive
  JOIN organization.profile profile ON profile.id = archive.organization_id
 CROSS JOIN LATERAL jsonb_populate_record(
    NULL::organization.carbon_price, archive.payload
 ) restored
 WHERE archive.kind = 'carbon_price'
ON CONFLICT DO NOTHING;

SELECT setval(
    pg_get_serial_sequence('organization.emission_factor', 'id'),
    COALESCE(MAX(id), 1),
    COUNT(*) > 0
)
FROM organization.emission_factor;

SELECT setval(
    pg_get_serial_sequence('organization.carbon_price', 'id'),
    COALESCE(MAX(id), 1),
    COUNT(*) > 0
)
FROM organization.carbon_price;

DELETE FROM organization.carbon_accounting_archive_7359 archive
 WHERE (archive.kind = 'emission_factor' AND EXISTS (
    SELECT 1 FROM organization.emission_factor factor
     WHERE factor.organization_id = archive.organization_id
       AND factor.id = archive.row_id
 )) OR (archive.kind = 'carbon_price' AND EXISTS (
    SELECT 1 FROM organization.carbon_price price
     WHERE price.organization_id = archive.organization_id
       AND price.id = archive.row_id
 ));

COMMENT ON TABLE organization.emission_factor IS
    'Append-only physical conversion factors; never utility prices.';
COMMENT ON TABLE organization.carbon_price IS
    'Append-only CO2e valuations disclosed separately from utility bills.';
COMMENT ON COLUMN ui.dashboard_settings.emission_factor_g_per_kwh IS
    'Explicit dashboard LBM override. Precedence: dashboard override, then organization.emission_factor, then deployment default.';
COMMENT ON COLUMN ui.dashboard_settings.emission_factor_mbm_g_per_kwh IS
    'Explicit dashboard MBM override. Precedence: dashboard override, then organization.emission_factor; no implicit market-based default.';

CREATE OR REPLACE FUNCTION organization.fn_emission_factor_add(
    p_org VARCHAR(120),
    p_payload JSONB
)
RETURNS SETOF organization.emission_factor
AS $$
DECLARE
    v_revision INTEGER;
BEGIN
    v_revision := COALESCE(
        (p_payload->>'revision')::INTEGER,
        (
            SELECT MAX(f.revision) + 1
            FROM organization.emission_factor f
            WHERE f.organization_id = p_org
              AND f.commodity = p_payload->>'commodity'
              AND f.billed_unit = p_payload->>'billedUnit'
              AND f.region = p_payload->>'region'
              AND f.accounting_basis = p_payload->>'accountingBasis'
              AND f.emissions_scope = p_payload->>'emissionsScope'
              AND f.effective_from = (p_payload->>'effectiveFrom')::TIMESTAMPTZ
              AND f.source_reference = p_payload->>'sourceReference'
        ),
        1
    );

    RETURN QUERY INSERT INTO organization.emission_factor (
        organization_id, commodity, billed_unit, region, accounting_basis,
        emissions_scope, factor_kg_per_unit, effective_from, effective_to,
        source_reference, revision
    ) VALUES (
        p_org,
        p_payload->>'commodity',
        p_payload->>'billedUnit',
        p_payload->>'region',
        p_payload->>'accountingBasis',
        p_payload->>'emissionsScope',
        (p_payload->>'factorKgPerUnit')::NUMERIC,
        (p_payload->>'effectiveFrom')::TIMESTAMPTZ,
        NULLIF(p_payload->>'effectiveTo', '')::TIMESTAMPTZ,
        p_payload->>'sourceReference',
        v_revision
    ) RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION organization.fn_emission_factor_list(
    p_org VARCHAR(120),
    p_limit INTEGER DEFAULT 100,
    p_before_id BIGINT DEFAULT NULL
)
RETURNS SETOF organization.emission_factor
AS $$
    SELECT * FROM organization.emission_factor
    WHERE organization_id = p_org
      AND (p_before_id IS NULL OR id < p_before_id)
    ORDER BY id DESC
    LIMIT GREATEST(1, LEAST(p_limit, 101));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION organization.fn_emission_factor_resolve(
    p_org VARCHAR(120),
    p_commodity VARCHAR(48),
    p_billed_unit VARCHAR(24),
    p_region VARCHAR(120),
    p_accounting_basis VARCHAR(24),
    p_emissions_scope VARCHAR(16),
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS SETOF organization.emission_factor
AS $$
    SELECT * FROM organization.emission_factor
    WHERE organization_id = p_org
      AND commodity = p_commodity
      AND billed_unit = p_billed_unit
      AND region IN (p_region, 'global')
      AND accounting_basis = p_accounting_basis
      AND (p_emissions_scope IS NULL OR emissions_scope = p_emissions_scope)
      AND effective_from <= p_from
      AND (effective_to IS NULL OR effective_to >= p_to)
    ORDER BY (region = p_region) DESC, effective_from DESC,
             revision DESC, created_at DESC
    LIMIT 1;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION organization.fn_carbon_price_add(
    p_org VARCHAR(120),
    p_payload JSONB
)
RETURNS SETOF organization.carbon_price
AS $$
DECLARE
    v_revision INTEGER;
BEGIN
    v_revision := COALESCE(
        (p_payload->>'revision')::INTEGER,
        (
            SELECT MAX(p.revision) + 1
            FROM organization.carbon_price p
            WHERE p.organization_id = p_org
              AND p.name = p_payload->>'name'
              AND p.price_type = p_payload->>'priceType'
              AND p.applies_to_scope = p_payload->>'appliesToScope'
              AND p.effective_from = (p_payload->>'effectiveFrom')::TIMESTAMPTZ
              AND p.source_reference = p_payload->>'sourceReference'
        ),
        1
    );

    RETURN QUERY INSERT INTO organization.carbon_price (
        organization_id, name, price_type, applies_to_scope, currency,
        amount_per_tonne, effective_from, effective_to, source_reference,
        revision
    ) VALUES (
        p_org,
        p_payload->>'name',
        p_payload->>'priceType',
        p_payload->>'appliesToScope',
        p_payload->>'currency',
        (p_payload->>'amountPerTonne')::NUMERIC,
        (p_payload->>'effectiveFrom')::TIMESTAMPTZ,
        NULLIF(p_payload->>'effectiveTo', '')::TIMESTAMPTZ,
        p_payload->>'sourceReference',
        v_revision
    ) RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION organization.fn_carbon_price_list(
    p_org VARCHAR(120),
    p_limit INTEGER DEFAULT 100,
    p_before_id BIGINT DEFAULT NULL
)
RETURNS SETOF organization.carbon_price
AS $$
    SELECT * FROM organization.carbon_price
    WHERE organization_id = p_org
      AND (p_before_id IS NULL OR id < p_before_id)
    ORDER BY id DESC
    LIMIT GREATEST(1, LEAST(p_limit, 101));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION organization.fn_carbon_price_resolve(
    p_org VARCHAR(120),
    p_scope VARCHAR(16),
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_price_type VARCHAR(16) DEFAULT NULL
)
RETURNS SETOF organization.carbon_price
AS $$
    WITH ranked AS (
        SELECT p.*,
               row_number() OVER (
                   PARTITION BY name, price_type, applies_to_scope, currency
                   ORDER BY effective_from DESC, revision DESC,
                            created_at DESC
               ) AS version_rank
        FROM organization.carbon_price p
        WHERE organization_id = p_org
          AND applies_to_scope IN (p_scope, 'all')
          AND effective_from <= p_from
          AND (effective_to IS NULL OR effective_to >= p_to)
          AND (p_price_type IS NULL OR price_type = p_price_type)
    ), preferred_scope AS (
        SELECT * FROM ranked r
        WHERE version_rank = 1
          AND (
              applies_to_scope = p_scope
              OR NOT EXISTS (
                  SELECT 1 FROM ranked exact
                  WHERE exact.version_rank = 1
                    AND exact.applies_to_scope = p_scope
              )
          )
    )
    SELECT id, organization_id, name, price_type, applies_to_scope, currency,
           amount_per_tonne, effective_from, effective_to, source_reference,
           revision, created_at
    FROM preferred_scope
    WHERE (SELECT count(*) FROM preferred_scope) = 1
    LIMIT 1;
$$ LANGUAGE sql;

--------------DOWN
INSERT INTO organization.carbon_accounting_archive_7359 (
    kind, organization_id, row_id, payload
)
SELECT 'carbon_price', organization_id, id, to_jsonb(price)
  FROM organization.carbon_price price
ON CONFLICT (kind, organization_id, row_id) DO UPDATE SET
    payload = EXCLUDED.payload, archived_at = now();

INSERT INTO organization.carbon_accounting_archive_7359 (
    kind, organization_id, row_id, payload
)
SELECT 'emission_factor', organization_id, id, to_jsonb(factor)
  FROM organization.emission_factor factor
ON CONFLICT (kind, organization_id, row_id) DO UPDATE SET
    payload = EXCLUDED.payload, archived_at = now();

COMMENT ON COLUMN ui.dashboard_settings.emission_factor_g_per_kwh IS NULL;
COMMENT ON COLUMN ui.dashboard_settings.emission_factor_mbm_g_per_kwh IS NULL;
-- LINT-IGNORE: additive-only -- rollback archives carbon configuration first.
DROP FUNCTION IF EXISTS organization.fn_carbon_price_resolve(
    VARCHAR(120), VARCHAR(16), TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR(16)
);
-- LINT-IGNORE: additive-only -- rollback archives carbon configuration first.
DROP FUNCTION IF EXISTS organization.fn_carbon_price_list(
    VARCHAR(120), INTEGER, BIGINT
);
-- LINT-IGNORE: additive-only -- rollback archives carbon configuration first.
DROP FUNCTION IF EXISTS organization.fn_carbon_price_add(VARCHAR(120), JSONB);
-- LINT-IGNORE: additive-only -- rollback archives carbon configuration first.
DROP FUNCTION IF EXISTS organization.fn_emission_factor_resolve(
    VARCHAR(120), VARCHAR(48), VARCHAR(24), VARCHAR(120), VARCHAR(24),
    VARCHAR(16), TIMESTAMPTZ, TIMESTAMPTZ
);
-- LINT-IGNORE: additive-only -- rollback archives carbon configuration first.
DROP FUNCTION IF EXISTS organization.fn_emission_factor_list(
    VARCHAR(120), INTEGER, BIGINT
);
-- LINT-IGNORE: additive-only -- rollback archives carbon configuration first.
DROP FUNCTION IF EXISTS organization.fn_emission_factor_add(VARCHAR(120), JSONB);
-- LINT-IGNORE: additive-only -- data is retained in carbon_accounting_archive_7359.
DROP TABLE IF EXISTS organization.carbon_price;
-- LINT-IGNORE: additive-only -- data is retained in carbon_accounting_archive_7359.
DROP TABLE IF EXISTS organization.emission_factor;
