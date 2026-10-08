--------------UP
-- JSON null is a value, not SQL NULL. The tariff API deliberately accepts
-- null for optional structured fields, so normalize only those top-level
-- fields before the existing upsert reaches JSON-object constraints.
ALTER FUNCTION organization.fn_tariff_upsert(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only -- retained for the reversible wrapper.
    RENAME TO fn_tariff_upsert_v7374;
ALTER FUNCTION organization.fn_tariff_upsert_with_components(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only -- retained for the reversible wrapper.
    RENAME TO fn_tariff_upsert_with_components_v7361;

CREATE FUNCTION organization.fn_tariff_upsert(
    p_org VARCHAR,
    p_payload JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_payload JSONB := p_payload;
BEGIN
    IF v_payload->'taxes' = 'null'::JSONB THEN
        v_payload := v_payload - 'taxes';
    END IF;
    IF v_payload->'demand' = 'null'::JSONB THEN
        v_payload := v_payload - 'demand';
    END IF;
    IF v_payload->'blocks' = 'null'::JSONB THEN
        v_payload := v_payload - 'blocks';
    END IF;
    RETURN organization.fn_tariff_upsert_v7374(p_org, v_payload);
END;
$$;

CREATE FUNCTION organization.fn_tariff_upsert_with_components(
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
        COALESCE(NULLIF(p_payload->'components', 'null'::JSONB), '[]'::JSONB)
    );
    RETURN v_tariff_id;
END;
$$;

--------------DOWN
-- LINT-IGNORE: additive-only -- restores the pre-normalization wrappers.
DROP FUNCTION IF EXISTS organization.fn_tariff_upsert_with_components(VARCHAR, JSONB);
-- LINT-IGNORE: additive-only -- restores the pre-normalization wrappers.
DROP FUNCTION IF EXISTS organization.fn_tariff_upsert(VARCHAR, JSONB);
ALTER FUNCTION organization.fn_tariff_upsert_with_components_v7361(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_upsert_with_components;
ALTER FUNCTION organization.fn_tariff_upsert_v7374(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_upsert;
