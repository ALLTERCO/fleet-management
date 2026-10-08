--------------UP
-- Country-specific charge classes are data, not engine branches. Organizations
-- may add registry rows without a schema migration.
CREATE TABLE IF NOT EXISTS organization.tariff_charge_class (
    organization_id VARCHAR(120) NOT NULL,
    key_name VARCHAR(64) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    PRIMARY KEY (organization_id, key_name),
    CONSTRAINT tariff_charge_class_key_chk CHECK (
        key_name ~ '^[a-z][a-z0-9_-]{0,63}$'
    )
);

INSERT INTO organization.tariff_charge_class (
    organization_id, key_name, display_name
)
SELECT profile.id, seed.key_name, seed.display_name
  FROM organization.profile profile
 CROSS JOIN (VALUES
    ('supply', 'Supply'),
    ('network', 'Network'),
    ('levy', 'Levy'),
    ('tax', 'Tax'),
    ('other', 'Other')
 ) AS seed(key_name, display_name)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS organization.tariff_price_component_archive_7361 (
    organization_id VARCHAR(120) NOT NULL,
    tariff_id INTEGER NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    sequence INTEGER NOT NULL,
    charge_type VARCHAR(24) NOT NULL,
    charge_class VARCHAR(64) NOT NULL,
    basis VARCHAR(24) NOT NULL,
    rate NUMERIC(20, 8) NOT NULL,
    applies_to VARCHAR(64)[] NOT NULL DEFAULT '{}',
    taxable BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from DATE,
    effective_to DATE,
    source_reference TEXT,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, tariff_id, code)
);

CREATE TABLE IF NOT EXISTS organization.tariff_price_component (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    tariff_id INTEGER NOT NULL
        REFERENCES organization.tariff(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    sequence INTEGER NOT NULL,
    charge_type VARCHAR(24) NOT NULL,
    charge_class VARCHAR(64) NOT NULL,
    basis VARCHAR(24) NOT NULL,
    rate NUMERIC(20, 8) NOT NULL,
    applies_to VARCHAR(64)[] NOT NULL DEFAULT '{}',
    taxable BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from DATE,
    effective_to DATE,
    source_reference TEXT,
    CONSTRAINT tariff_component_class_fk FOREIGN KEY (
        organization_id, charge_class
    ) REFERENCES organization.tariff_charge_class (
        organization_id, key_name
    ),
    CONSTRAINT tariff_component_code_chk CHECK (
        code ~ '^[a-z][a-z0-9_-]{0,63}$'
    ),
    CONSTRAINT tariff_component_sequence_chk CHECK (sequence > 0),
    CONSTRAINT tariff_component_type_chk CHECK (charge_type IN (
        'per_unit', 'fixed_day', 'fixed_month', 'percentage', 'minimum'
    )),
    CONSTRAINT tariff_component_basis_chk CHECK (basis IN (
        'consumption', 'energy', 'demand', 'standing', 'subtotal'
    )),
    CONSTRAINT tariff_component_period_chk CHECK (
        effective_to IS NULL OR effective_from IS NULL
        OR effective_to > effective_from
    ),
    CONSTRAINT tariff_component_percentage_chk CHECK (
        charge_type <> 'percentage' OR (rate >= 0 AND rate <= 100)
    ),
    CONSTRAINT tariff_component_minimum_chk CHECK (
        charge_type <> 'minimum' OR rate >= 0
    ),
    CONSTRAINT tariff_component_code_uq UNIQUE (tariff_id, code),
    CONSTRAINT tariff_component_sequence_uq UNIQUE (tariff_id, sequence)
);

CREATE INDEX IF NOT EXISTS tariff_price_component_effective_idx
    ON organization.tariff_price_component (
        organization_id, tariff_id, effective_from, effective_to, sequence
    );

INSERT INTO organization.tariff_charge_class (
    organization_id, key_name, display_name
)
SELECT DISTINCT archive.organization_id,
       archive.charge_class,
       initcap(replace(archive.charge_class, '_', ' '))
  FROM organization.tariff_price_component_archive_7361 archive
  JOIN organization.profile profile ON profile.id = archive.organization_id
ON CONFLICT DO NOTHING;

INSERT INTO organization.tariff_price_component (
    organization_id, tariff_id, code, name, sequence, charge_type,
    charge_class, basis, rate, applies_to, taxable,
    effective_from, effective_to, source_reference
)
SELECT archive.organization_id, archive.tariff_id, archive.code, archive.name,
       archive.sequence, archive.charge_type, archive.charge_class,
       archive.basis, archive.rate, archive.applies_to, archive.taxable,
       archive.effective_from, archive.effective_to, archive.source_reference
  FROM organization.tariff_price_component_archive_7361 archive
  JOIN organization.tariff tariff
    ON tariff.id = archive.tariff_id
   AND tariff.organization_id = archive.organization_id
ON CONFLICT DO NOTHING;

DELETE FROM organization.tariff_price_component_archive_7361 archive
 WHERE EXISTS (
    SELECT 1 FROM organization.tariff_price_component component
     WHERE component.organization_id = archive.organization_id
       AND component.tariff_id = archive.tariff_id
       AND component.code = archive.code
 );

CREATE OR REPLACE FUNCTION organization.fn_tariff_component_list(
    p_org VARCHAR,
    p_tariff_id INTEGER
)
RETURNS SETOF organization.tariff_price_component
LANGUAGE sql STABLE
AS $$
    SELECT component.*
      FROM organization.tariff_price_component component
     WHERE component.organization_id = p_org
       AND component.tariff_id = p_tariff_id
     ORDER BY component.sequence;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_write_components(
    p_org VARCHAR,
    p_tariff_id INTEGER,
    p_components JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    component JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM organization.tariff tariff
         WHERE tariff.organization_id = p_org AND tariff.id = p_tariff_id
    ) THEN
        RAISE EXCEPTION 'tariff % not in org %', p_tariff_id, p_org;
    END IF;
    IF jsonb_typeof(COALESCE(p_components, '[]'::JSONB)) <> 'array' THEN
        RAISE EXCEPTION 'components must be an array';
    END IF;

    -- Register new jurisdiction-specific classes before inserting their lines.
    INSERT INTO organization.tariff_charge_class (
        organization_id, key_name, display_name
    )
    SELECT p_org,
           item->>'chargeClass',
           initcap(replace(item->>'chargeClass', '_', ' '))
      FROM jsonb_array_elements(COALESCE(p_components, '[]'::JSONB)) item
    ON CONFLICT DO NOTHING;

    DELETE FROM organization.tariff_price_component
     WHERE organization_id = p_org AND tariff_id = p_tariff_id;

    FOR component IN
        SELECT value FROM jsonb_array_elements(
            COALESCE(p_components, '[]'::JSONB)
        ) ORDER BY (value->>'sequence')::INTEGER
    LOOP
        INSERT INTO organization.tariff_price_component (
            organization_id, tariff_id, code, name, sequence, charge_type,
            charge_class, basis, rate, applies_to, taxable,
            effective_from, effective_to, source_reference
        ) VALUES (
            p_org, p_tariff_id, component->>'code', component->>'name',
            (component->>'sequence')::INTEGER,
            component->>'chargeType', component->>'chargeClass',
            component->>'basis', (component->>'rate')::NUMERIC,
            ARRAY(SELECT jsonb_array_elements_text(
                COALESCE(component->'appliesTo', '[]'::JSONB)
            )),
            COALESCE((component->>'taxable')::BOOLEAN, TRUE),
            NULLIF(component->>'effectiveFrom', '')::DATE,
            NULLIF(component->>'effectiveTo', '')::DATE,
            NULLIF(component->>'sourceReference', '')
        );
    END LOOP;
END;
$$;

-- One database call keeps the legacy tariff facade and its compiled component
-- vector atomic. A validation or FK failure rolls back both halves.
CREATE OR REPLACE FUNCTION organization.fn_tariff_upsert_with_components(
    p_org VARCHAR,
    p_payload JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tariff_id INTEGER;
BEGIN
    v_tariff_id := organization.fn_tariff_upsert(p_org, p_payload);
    PERFORM organization.fn_tariff_write_components(
        p_org,
        v_tariff_id,
        COALESCE(p_payload->'components', '[]'::JSONB)
    );
    RETURN v_tariff_id;
END;
$$;

--------------DOWN
INSERT INTO organization.tariff_price_component_archive_7361 (
    organization_id, tariff_id, code, name, sequence, charge_type,
    charge_class, basis, rate, applies_to, taxable,
    effective_from, effective_to, source_reference
)
SELECT organization_id, tariff_id, code, name, sequence, charge_type,
       charge_class, basis, rate, applies_to, taxable,
       effective_from, effective_to, source_reference
  FROM organization.tariff_price_component
ON CONFLICT (organization_id, tariff_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    sequence = EXCLUDED.sequence,
    charge_type = EXCLUDED.charge_type,
    charge_class = EXCLUDED.charge_class,
    basis = EXCLUDED.basis,
    rate = EXCLUDED.rate,
    applies_to = EXCLUDED.applies_to,
    taxable = EXCLUDED.taxable,
    effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to,
    source_reference = EXCLUDED.source_reference,
    archived_at = now();

-- LINT-IGNORE: additive-only -- rollback archives component data first.
DROP FUNCTION IF EXISTS organization.fn_tariff_upsert_with_components(VARCHAR, JSONB);
-- LINT-IGNORE: additive-only -- rollback archives component data first.
DROP FUNCTION IF EXISTS organization.fn_tariff_write_components(VARCHAR, INTEGER, JSONB);
-- LINT-IGNORE: additive-only -- rollback archives component data first.
DROP FUNCTION IF EXISTS organization.fn_tariff_component_list(VARCHAR, INTEGER);
-- LINT-IGNORE: additive-only -- rollback archives component data first.
DROP TABLE IF EXISTS organization.tariff_price_component;
-- LINT-IGNORE: additive-only -- registry values are restored from the archive.
DROP TABLE IF EXISTS organization.tariff_charge_class;
