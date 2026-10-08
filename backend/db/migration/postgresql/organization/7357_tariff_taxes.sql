--------------UP
-- Jurisdiction-neutral ordered tax rules. NULL preserves the legacy vat_pct
-- fallback; an explicit [] means that this tariff has no tax.
ALTER TABLE organization.tariff
    ADD COLUMN IF NOT EXISTS taxes JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'organization__tariff_taxes_array'
          AND conrelid = 'organization.tariff'::regclass
    ) THEN
        ALTER TABLE organization.tariff
            ADD CONSTRAINT organization__tariff_taxes_array
            CHECK (taxes IS NULL OR jsonb_typeof(taxes) = 'array');
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_upsert(p_org VARCHAR, p_payload JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER := NULLIF(p_payload->>'id','')::INTEGER;
    v_season JSONB;
    v_season_id INTEGER;
    v_win JSONB;
BEGIN
    IF v_id IS NULL THEN
        INSERT INTO organization.tariff
            (organization_id, name, currency, timezone, billing_day, kind,
             standing_charge, standing_charge_period, vat_pct, taxes,
             demand_rate, demand, effective_from, effective_to,
             source_reference, blocks)
        VALUES (
            p_org,
            p_payload->>'name',
            p_payload->>'currency',
            p_payload->>'timezone',
            (p_payload->>'billingDay')::SMALLINT,
            p_payload->>'kind',
            COALESCE((p_payload->>'standingCharge')::DOUBLE PRECISION, 0),
            COALESCE(p_payload->>'standingChargePeriod', 'month'),
            (p_payload->>'vatPct')::DOUBLE PRECISION,
            NULLIF(p_payload->'taxes', 'null'::jsonb),
            (p_payload->>'demandRate')::DOUBLE PRECISION,
            p_payload->'demand',
            (p_payload->>'effectiveFrom')::DATE,
            (p_payload->>'effectiveTo')::DATE,
            p_payload->>'sourceReference',
            p_payload->'blocks'
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE organization.tariff SET
            name = p_payload->>'name',
            currency = p_payload->>'currency',
            timezone = p_payload->>'timezone',
            billing_day = (p_payload->>'billingDay')::SMALLINT,
            kind = p_payload->>'kind',
            standing_charge = COALESCE((p_payload->>'standingCharge')::DOUBLE PRECISION, 0),
            standing_charge_period = COALESCE(p_payload->>'standingChargePeriod', 'month'),
            vat_pct = (p_payload->>'vatPct')::DOUBLE PRECISION,
            taxes = NULLIF(p_payload->'taxes', 'null'::jsonb),
            demand_rate = (p_payload->>'demandRate')::DOUBLE PRECISION,
            demand = p_payload->'demand',
            effective_from = (p_payload->>'effectiveFrom')::DATE,
            effective_to = (p_payload->>'effectiveTo')::DATE,
            source_reference = p_payload->>'sourceReference',
            blocks = p_payload->'blocks',
            updated = CURRENT_TIMESTAMP
        WHERE id = v_id AND organization_id = p_org;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'tariff % not in org %', v_id, p_org;
        END IF;
    END IF;

    DELETE FROM organization.tariff_season WHERE tariff_id = v_id;
    FOR v_season IN
        SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'seasons', '[]'::jsonb))
    LOOP
        INSERT INTO organization.tariff_season (tariff_id, start_md, end_md)
        VALUES (v_id, v_season->>'startMonthDay', v_season->>'endMonthDay')
        RETURNING id INTO v_season_id;
        FOR v_win IN
            SELECT * FROM jsonb_array_elements(COALESCE(v_season->'windows', '[]'::jsonb))
        LOOP
            INSERT INTO organization.tariff_window
                (season_id, days_mask, start_time, end_time, price)
            VALUES (
                v_season_id,
                (v_win->>'daysMask')::SMALLINT,
                (v_win->>'startTime')::TIME,
                (v_win->>'endTime')::TIME,
                (v_win->>'price')::DOUBLE PRECISION
            );
        END LOOP;
    END LOOP;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_get(p_org VARCHAR, p_id INTEGER)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
    SELECT jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'currency', t.currency,
        'timezone', t.timezone,
        'billingDay', t.billing_day,
        'kind', t.kind,
        'standingCharge', t.standing_charge,
        'standingChargePeriod', t.standing_charge_period,
        'vatPct', t.vat_pct,
        'taxes', t.taxes,
        'demandRate', t.demand_rate,
        'demand', t.demand,
        'blocks', t.blocks,
        'effectiveFrom', to_char(t.effective_from, 'YYYY-MM-DD'),
        'effectiveTo', to_char(t.effective_to, 'YYYY-MM-DD'),
        'sourceReference', t.source_reference,
        'seasons',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'startMonthDay', s.start_md,
                        'endMonthDay', s.end_md,
                        'windows', COALESCE(
                            (
                                SELECT jsonb_agg(
                                    jsonb_build_object(
                                        'daysMask', w.days_mask,
                                        'startTime', to_char(w.start_time, 'HH24:MI'),
                                        'endTime', to_char(w.end_time, 'HH24:MI'),
                                        'price', w.price
                                    ) ORDER BY w.id
                                )
                                FROM organization.tariff_window w
                                WHERE w.season_id = s.id
                            ),
                            '[]'::jsonb
                        )
                    ) ORDER BY s.id
                )
                FROM organization.tariff_season s
                WHERE s.tariff_id = t.id
            ),
            '[]'::jsonb
        )
    )
    FROM organization.tariff t
    WHERE t.id = p_id AND t.organization_id = p_org;
$$;

--------------DOWN
-- Restore the 7356 function bodies before removing their taxes dependency.
CREATE OR REPLACE FUNCTION organization.fn_tariff_upsert(p_org VARCHAR, p_payload JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER := NULLIF(p_payload->>'id','')::INTEGER;
    v_season JSONB;
    v_season_id INTEGER;
    v_win JSONB;
BEGIN
    IF v_id IS NULL THEN
        INSERT INTO organization.tariff
            (organization_id, name, currency, timezone, billing_day, kind,
             standing_charge, standing_charge_period, vat_pct, demand_rate,
             demand, effective_from, effective_to, source_reference, blocks)
        VALUES (
            p_org,
            p_payload->>'name',
            p_payload->>'currency',
            p_payload->>'timezone',
            (p_payload->>'billingDay')::SMALLINT,
            p_payload->>'kind',
            COALESCE((p_payload->>'standingCharge')::DOUBLE PRECISION, 0),
            COALESCE(p_payload->>'standingChargePeriod', 'month'),
            (p_payload->>'vatPct')::DOUBLE PRECISION,
            (p_payload->>'demandRate')::DOUBLE PRECISION,
            p_payload->'demand',
            (p_payload->>'effectiveFrom')::DATE,
            (p_payload->>'effectiveTo')::DATE,
            p_payload->>'sourceReference',
            p_payload->'blocks'
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE organization.tariff SET
            name = p_payload->>'name',
            currency = p_payload->>'currency',
            timezone = p_payload->>'timezone',
            billing_day = (p_payload->>'billingDay')::SMALLINT,
            kind = p_payload->>'kind',
            standing_charge = COALESCE((p_payload->>'standingCharge')::DOUBLE PRECISION, 0),
            standing_charge_period = COALESCE(p_payload->>'standingChargePeriod', 'month'),
            vat_pct = (p_payload->>'vatPct')::DOUBLE PRECISION,
            demand_rate = (p_payload->>'demandRate')::DOUBLE PRECISION,
            demand = p_payload->'demand',
            effective_from = (p_payload->>'effectiveFrom')::DATE,
            effective_to = (p_payload->>'effectiveTo')::DATE,
            source_reference = p_payload->>'sourceReference',
            blocks = p_payload->'blocks',
            updated = CURRENT_TIMESTAMP
        WHERE id = v_id AND organization_id = p_org;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'tariff % not in org %', v_id, p_org;
        END IF;
    END IF;

    DELETE FROM organization.tariff_season WHERE tariff_id = v_id;
    FOR v_season IN
        SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'seasons', '[]'::jsonb))
    LOOP
        INSERT INTO organization.tariff_season (tariff_id, start_md, end_md)
        VALUES (v_id, v_season->>'startMonthDay', v_season->>'endMonthDay')
        RETURNING id INTO v_season_id;
        FOR v_win IN
            SELECT * FROM jsonb_array_elements(COALESCE(v_season->'windows', '[]'::jsonb))
        LOOP
            INSERT INTO organization.tariff_window
                (season_id, days_mask, start_time, end_time, price)
            VALUES (
                v_season_id,
                (v_win->>'daysMask')::SMALLINT,
                (v_win->>'startTime')::TIME,
                (v_win->>'endTime')::TIME,
                (v_win->>'price')::DOUBLE PRECISION
            );
        END LOOP;
    END LOOP;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_get(p_org VARCHAR, p_id INTEGER)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
    SELECT jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'currency', t.currency,
        'timezone', t.timezone,
        'billingDay', t.billing_day,
        'kind', t.kind,
        'standingCharge', t.standing_charge,
        'standingChargePeriod', t.standing_charge_period,
        'vatPct', t.vat_pct,
        'demandRate', t.demand_rate,
        'demand', t.demand,
        'blocks', t.blocks,
        'effectiveFrom', to_char(t.effective_from, 'YYYY-MM-DD'),
        'effectiveTo', to_char(t.effective_to, 'YYYY-MM-DD'),
        'sourceReference', t.source_reference,
        'seasons',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'startMonthDay', s.start_md,
                        'endMonthDay', s.end_md,
                        'windows', COALESCE(
                            (
                                SELECT jsonb_agg(
                                    jsonb_build_object(
                                        'daysMask', w.days_mask,
                                        'startTime', to_char(w.start_time, 'HH24:MI'),
                                        'endTime', to_char(w.end_time, 'HH24:MI'),
                                        'price', w.price
                                    ) ORDER BY w.id
                                )
                                FROM organization.tariff_window w
                                WHERE w.season_id = s.id
                            ),
                            '[]'::jsonb
                        )
                    ) ORDER BY s.id
                )
                FROM organization.tariff_season s
                WHERE s.tariff_id = t.id
            ),
            '[]'::jsonb
        )
    )
    FROM organization.tariff t
    WHERE t.id = p_id AND t.organization_id = p_org;
$$;

ALTER TABLE organization.tariff
    DROP CONSTRAINT IF EXISTS organization__tariff_taxes_array,
    DROP COLUMN IF EXISTS taxes;
