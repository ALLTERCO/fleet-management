--------------UP
-- Move legacy dashboard PV config into logical meters (the SSOT). Each
-- dashboard's pv_grid_refs/pv_generation_refs become a role=grid / role=pv
-- meter for the dashboard's org. Whole-device refs (channel null) expand to the
-- channels that have stored energy. The logic lives in a function so an
-- integration test can seed data and call it; the migration invokes it once for
-- existing data. Idempotent at the point level via the (device, channel, tag)
-- UNIQUE; meters created here are tagged origin='dashboard_pv' so the DOWN
-- reverts precisely. PV mode stays on the dashboard (display interpretation).

CREATE OR REPLACE FUNCTION fm.fn_migrate_dashboard_pv()
RETURNS INTEGER
AS $$
DECLARE
    r        RECORD;
    ref      JSONB;
    v_meter  BIGINT;
    v_device INT;
    v_count  INTEGER := 0;
BEGIN
    FOR r IN
        SELECT d.organization_id AS org, ds.dashboard_id AS did,
               'grid' AS role, ds.pv_grid_refs AS refs
        FROM ui.dashboard_settings ds
        JOIN ui.dashboard d ON d.id = ds.dashboard_id
        WHERE jsonb_array_length(COALESCE(ds.pv_grid_refs, '[]'::jsonb)) > 0
        UNION ALL
        SELECT d.organization_id, ds.dashboard_id,
               'pv', ds.pv_generation_refs
        FROM ui.dashboard_settings ds
        JOIN ui.dashboard d ON d.id = ds.dashboard_id
        WHERE jsonb_array_length(COALESCE(ds.pv_generation_refs, '[]'::jsonb)) > 0
    LOOP
        INSERT INTO fm.logical_meter (
            organization_id, name, utility_type, role,
            phase_mode, aggregation_mode, origin
        )
        VALUES (
            r.org,
            CASE WHEN r.role = 'grid' THEN 'Grid' ELSE 'Solar' END
                || ' (dashboard ' || r.did || ')',
            'electric', r.role, 'unknown', 'sum_points', 'dashboard_pv'
        )
        RETURNING id INTO v_meter;

        FOR ref IN SELECT * FROM jsonb_array_elements(r.refs)
        LOOP
            SELECT id INTO v_device
            FROM device.list
            WHERE external_id = ref->>'device' AND organization_id = r.org;
            IF v_device IS NULL THEN
                CONTINUE;  -- device no longer in this org; skip the ref
            END IF;

            IF ref->>'channel' IS NOT NULL THEN
                INSERT INTO fm.logical_meter_point
                    (logical_meter_id, device, channel, phase, tag)
                VALUES
                    (v_meter, v_device, (ref->>'channel')::SMALLINT, 'z',
                     'total_act_energy')
                ON CONFLICT (device, channel, tag) DO NOTHING;
            ELSE
                -- Whole device: one point per channel that has stored energy.
                INSERT INTO fm.logical_meter_point
                    (logical_meter_id, device, channel, phase, tag)
                SELECT v_meter, v_device, c.channel, 'z', 'total_act_energy'
                FROM (
                    SELECT DISTINCT channel
                    FROM device_em.energy_15min
                    WHERE device = v_device AND tag = 'total_act_energy'
                ) c
                ON CONFLICT (device, channel, tag) DO NOTHING;

                -- No stored channels yet: fall back to channel 0 so the meter
                -- is not empty.
                IF NOT EXISTS (
                    SELECT 1 FROM fm.logical_meter_point
                    WHERE logical_meter_id = v_meter AND device = v_device
                ) THEN
                    INSERT INTO fm.logical_meter_point
                        (logical_meter_id, device, channel, phase, tag)
                    VALUES (v_meter, v_device, 0, 'z', 'total_act_energy')
                    ON CONFLICT (device, channel, tag) DO NOTHING;
                END IF;
            END IF;
        END LOOP;

        -- Every ref's device/channel was unresolvable or already owned: drop
        -- the empty meter rather than leave a meaningless row.
        IF NOT EXISTS (
            SELECT 1 FROM fm.logical_meter_point WHERE logical_meter_id = v_meter
        ) THEN
            DELETE FROM fm.logical_meter WHERE id = v_meter;
        ELSE
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

SELECT fm.fn_migrate_dashboard_pv();
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_migrate_dashboard_pv();
DELETE FROM fm.logical_meter WHERE origin = 'dashboard_pv';
