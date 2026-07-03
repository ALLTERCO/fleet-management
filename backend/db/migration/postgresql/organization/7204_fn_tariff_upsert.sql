--------------UP
-- Upsert a tariff and fully replace its seasons+windows from a JSON payload, in
-- one statement-transaction. Org-scoped: an update only matches rows in p_org.
CREATE OR REPLACE FUNCTION organization.fn_tariff_upsert(p_org VARCHAR, p_payload JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id    INTEGER := NULLIF(p_payload->>'id','')::INTEGER;
    v_season JSONB;
    v_season_id INTEGER;
    v_win JSONB;
BEGIN
    IF v_id IS NULL THEN
        INSERT INTO organization.tariff
            (organization_id, name, currency, timezone, billing_day, kind,
             standing_charge, standing_charge_period, vat_pct, demand_rate)
        VALUES (p_org, p_payload->>'name', p_payload->>'currency',
                p_payload->>'timezone', (p_payload->>'billingDay')::SMALLINT,
                p_payload->>'kind', COALESCE((p_payload->>'standingCharge')::DOUBLE PRECISION,0),
                COALESCE(p_payload->>'standingChargePeriod','month'),
                (p_payload->>'vatPct')::DOUBLE PRECISION,
                (p_payload->>'demandRate')::DOUBLE PRECISION)
        RETURNING id INTO v_id;
    ELSE
        UPDATE organization.tariff SET
            name=p_payload->>'name', currency=p_payload->>'currency',
            timezone=p_payload->>'timezone', billing_day=(p_payload->>'billingDay')::SMALLINT,
            kind=p_payload->>'kind',
            standing_charge=COALESCE((p_payload->>'standingCharge')::DOUBLE PRECISION,0),
            standing_charge_period=COALESCE(p_payload->>'standingChargePeriod','month'),
            vat_pct=(p_payload->>'vatPct')::DOUBLE PRECISION,
            demand_rate=(p_payload->>'demandRate')::DOUBLE PRECISION,
            updated=CURRENT_TIMESTAMP
        WHERE id=v_id AND organization_id=p_org;
        IF NOT FOUND THEN RAISE EXCEPTION 'tariff % not in org %', v_id, p_org; END IF;
    END IF;

    DELETE FROM organization.tariff_season WHERE tariff_id=v_id;
    FOR v_season IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'seasons','[]'::jsonb))
    LOOP
        INSERT INTO organization.tariff_season (tariff_id, start_md, end_md)
        VALUES (v_id, v_season->>'startMonthDay', v_season->>'endMonthDay')
        RETURNING id INTO v_season_id;
        FOR v_win IN SELECT * FROM jsonb_array_elements(COALESCE(v_season->'windows','[]'::jsonb))
        LOOP
            INSERT INTO organization.tariff_window
                (season_id, days_mask, start_time, end_time, price)
            VALUES (v_season_id, (v_win->>'daysMask')::SMALLINT,
                    (v_win->>'startTime')::TIME, (v_win->>'endTime')::TIME,
                    (v_win->>'price')::DOUBLE PRECISION);
        END LOOP;
    END LOOP;
    RETURN v_id;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_upsert(VARCHAR, JSONB);
