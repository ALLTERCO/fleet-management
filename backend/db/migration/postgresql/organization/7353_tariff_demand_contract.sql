--------------UP
-- Additive structured demand contract and tariff-wide contract provenance.
-- Legacy demand_rate remains intact for backwards-compatible reads/writes.
ALTER TABLE organization.tariff
    ADD COLUMN IF NOT EXISTS demand JSONB,
    ADD COLUMN IF NOT EXISTS effective_from DATE,
    ADD COLUMN IF NOT EXISTS effective_to DATE,
    ADD COLUMN IF NOT EXISTS source_reference VARCHAR(500);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'organization__tariff_demand_object'
          AND conrelid = 'organization.tariff'::regclass
    ) THEN
        ALTER TABLE organization.tariff
            ADD CONSTRAINT organization__tariff_demand_object
            CHECK (demand IS NULL OR jsonb_typeof(demand) = 'object');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'organization__tariff_effective_range'
          AND conrelid = 'organization.tariff'::regclass
    ) THEN
        ALTER TABLE organization.tariff
            ADD CONSTRAINT organization__tariff_effective_range
            CHECK (
                effective_from IS NULL
                OR effective_to IS NULL
                OR effective_from <= effective_to
            );
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
             standing_charge, standing_charge_period, vat_pct, demand_rate,
             demand, effective_from, effective_to, source_reference)
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
            p_payload->>'sourceReference'
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

DROP FUNCTION IF EXISTS organization.fn_tariff_list(VARCHAR);
CREATE FUNCTION organization.fn_tariff_list(p_org VARCHAR)
RETURNS TABLE (
    id INTEGER,
    name VARCHAR,
    kind VARCHAR,
    currency VARCHAR,
    effective_from DATE,
    effective_to DATE,
    source_reference VARCHAR
)
LANGUAGE sql STABLE
AS $$
    SELECT t.id, t.name, t.kind, t.currency,
           t.effective_from, t.effective_to, t.source_reference
      FROM organization.tariff t
     WHERE t.organization_id = p_org
     ORDER BY t.name;
$$;

--------------DOWN
-- Restore the pre-migration functions before removing the new columns.
DROP FUNCTION IF EXISTS organization.fn_tariff_list(VARCHAR);
CREATE FUNCTION organization.fn_tariff_list(p_org VARCHAR)
RETURNS TABLE (id INTEGER, name VARCHAR, kind VARCHAR, currency VARCHAR)
LANGUAGE sql STABLE
AS $$
    SELECT id, name, kind, currency FROM organization.tariff
    WHERE organization_id = p_org ORDER BY name;
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
             standing_charge, standing_charge_period, vat_pct, demand_rate)
        VALUES (
            p_org, p_payload->>'name', p_payload->>'currency',
            p_payload->>'timezone', (p_payload->>'billingDay')::SMALLINT,
            p_payload->>'kind', COALESCE((p_payload->>'standingCharge')::DOUBLE PRECISION, 0),
            COALESCE(p_payload->>'standingChargePeriod', 'month'),
            (p_payload->>'vatPct')::DOUBLE PRECISION,
            (p_payload->>'demandRate')::DOUBLE PRECISION
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
    DROP CONSTRAINT organization__tariff_effective_range,
    DROP CONSTRAINT organization__tariff_demand_object,
    DROP COLUMN source_reference,
    DROP COLUMN effective_to,
    DROP COLUMN effective_from,
    DROP COLUMN demand;
