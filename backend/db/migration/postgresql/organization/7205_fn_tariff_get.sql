--------------UP
-- Return one tariff with nested seasons+windows as JSON, org-scoped. NULL if
-- the id is not in the org. Emits explicit camelCase keys to match TariffSpec /
-- the bill-charge math (billingDay, standingCharge, vatPct, demandRate); a bare
-- to_jsonb(t) would return snake_case and the whole BILL section would vanish.
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
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_get(VARCHAR, INTEGER);
