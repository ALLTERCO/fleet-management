--------------UP
-- Canonical returned/injected volume is an explicit cumulative counter. It is
-- not inferred from a negative import delta or from a generic volume sensor.
-- The gas domain distinguishes it from water, just like volume_m3.

SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_commodity_for(p_domain TEXT, p_tag TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_domain = 'gas' THEN 'gas'
        WHEN p_tag IN ('volume_l','volume_m3','volume_returned_m3','volume_storage_l','volume_flow_m3h') THEN 'water'
        WHEN p_tag = 'thermal_energy_kwh' THEN 'heat'
        WHEN p_domain = 'thermal' THEN 'heat'
        WHEN p_domain IN ('ac_mains','dc_pv','dc_battery','dc_bus')
            THEN 'electricity'
        ELSE 'electricity'
    END;
$$;

-- The report functions deliberately own the cumulative-vs-instantaneous
-- choice. Replace the one canonical delta-tag fragment in all eight installed
-- variants and assert the expected surface, so a future signature/function
-- change fails this migration rather than averaging returned volume.
DO $migration$
DECLARE
    v_function RECORD;
    v_definition TEXT;
    v_count INTEGER := 0;
BEGIN
    FOR v_function IN
        SELECT p.oid, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'device_em'
          AND p.proname = ANY(ARRAY[
              'fn_report_stats',
              'fn_report_stats_paged',
              'fn_report_stats_by_phase',
              'fn_report_stats_by_phase_paged',
              'fn_report_stats_rollup',
              'fn_report_stats_rollup_paged',
              'fn_report_stats_rollup_by_phase',
              'fn_report_stats_rollup_by_phase_paged'
          ])
    LOOP
        v_definition := pg_get_functiondef(v_function.oid);
        IF position(
            '''volume_m3'',''thermal_energy_kwh''' IN v_definition
        ) = 0 OR position('''volume_returned_m3''' IN v_definition) > 0 THEN
            RAISE EXCEPTION
                'unexpected delta-tag body for device_em.%',
                v_function.proname;
        END IF;
        v_definition := replace(
            v_definition,
            '''volume_m3'',''thermal_energy_kwh''',
            '''volume_m3'',''volume_returned_m3'',''thermal_energy_kwh'''
        );
        EXECUTE v_definition;
        v_count := v_count + 1;
    END LOOP;
    IF v_count <> 8 THEN
        RAISE EXCEPTION
            'expected 8 device_em report functions, found %', v_count;
    END IF;
END;
$migration$;

-- Normally no row can predate the vocabulary/constraint migration. Keep a
-- bounded restamp for operator/direct-SQL rows installed during a rolling
-- deploy without rewriting unrelated compressed history.
SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

UPDATE device_em.energy_15min
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE tag = 'volume_returned_m3'
  AND commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);

UPDATE device_em.lifetime_counters
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE tag = 'volume_returned_m3'
  AND commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);

UPDATE device_em.stats
SET commodity = device_em.fn_commodity_for(domain, tag)
WHERE tag = 'volume_returned_m3'
  AND commodity IS DISTINCT FROM device_em.fn_commodity_for(domain, tag);
--------------DOWN
-- Refuse to reinterpret persisted injection as electricity/water or to average
-- its cumulative buckets. The operator must remove/export those rows before a
-- binary rollback that no longer understands their direction.
-- Match the operator-repair maintenance lock: reads remain available while all
-- three ingestion targets stop accepting a returned-volume row between the
-- guard and the function rollback. The migration transaction holds this lock
-- through commit.
LOCK TABLE device_em.stats, device_em.energy_15min,
           device_em.lifetime_counters
    IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM device_em.energy_15min
        WHERE tag = 'volume_returned_m3'
    ) OR EXISTS (
        SELECT 1 FROM device_em.lifetime_counters
        WHERE tag = 'volume_returned_m3'
    ) OR EXISTS (
        SELECT 1 FROM device_em.stats
        WHERE tag = 'volume_returned_m3'
    ) THEN
        RAISE EXCEPTION
            'cannot roll back returned-volume tag while metering rows use it';
    END IF;
END;
$$;

DO $migration$
DECLARE
    v_function RECORD;
    v_definition TEXT;
    v_count INTEGER := 0;
BEGIN
    FOR v_function IN
        SELECT p.oid, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'device_em'
          AND p.proname = ANY(ARRAY[
              'fn_report_stats',
              'fn_report_stats_paged',
              'fn_report_stats_by_phase',
              'fn_report_stats_by_phase_paged',
              'fn_report_stats_rollup',
              'fn_report_stats_rollup_paged',
              'fn_report_stats_rollup_by_phase',
              'fn_report_stats_rollup_by_phase_paged'
          ])
    LOOP
        v_definition := pg_get_functiondef(v_function.oid);
        IF position(
            '''volume_m3'',''volume_returned_m3'',''thermal_energy_kwh'''
            IN v_definition
        ) = 0 THEN
            RAISE EXCEPTION
                'unexpected returned-volume body for device_em.%',
                v_function.proname;
        END IF;
        v_definition := replace(
            v_definition,
            '''volume_m3'',''volume_returned_m3'',''thermal_energy_kwh''',
            '''volume_m3'',''thermal_energy_kwh'''
        );
        EXECUTE v_definition;
        v_count := v_count + 1;
    END LOOP;
    IF v_count <> 8 THEN
        RAISE EXCEPTION
            'expected 8 device_em report functions, found %', v_count;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION device_em.fn_commodity_for(p_domain TEXT, p_tag TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_domain = 'gas' THEN 'gas'
        WHEN p_tag IN ('volume_l','volume_m3','volume_storage_l','volume_flow_m3h') THEN 'water'
        WHEN p_tag = 'thermal_energy_kwh' THEN 'heat'
        WHEN p_domain = 'thermal' THEN 'heat'
        WHEN p_domain IN ('ac_mains','dc_pv','dc_battery','dc_bus')
            THEN 'electricity'
        ELSE 'electricity'
    END;
$$;
