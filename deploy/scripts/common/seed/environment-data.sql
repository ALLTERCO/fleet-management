-- Synthetic environmental sensors + N days of 15-minute history and events.
-- Dev DB only. Device rows are stable; marker-owned telemetry is regenerated.
-- One device per family so every capability tab lights up (water excluded).
DO $plpgsql$
DECLARE
    v_org_id VARCHAR(120);
    v_upserted INTEGER;
    v_days   INTEGER := 7;
BEGIN
    SELECT id INTO v_org_id
    FROM organization.profile ORDER BY created_at, id LIMIT 1;
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found — run office seed first.';
    END IF;

    CREATE TEMP TABLE _desired_environment_devices (
        external_id VARCHAR(50) PRIMARY KEY,
        name        TEXT NOT NULL,
        model       TEXT NOT NULL,
        app         TEXT NOT NULL
    ) ON COMMIT DROP;
    INSERT INTO _desired_environment_devices VALUES
        ('demo-env-climate',  'Demo Climate H&T',    'H&T Gen3',      'SNSN-0013A'),
        ('demo-env-light',    'Demo Light Sensor',   'Illuminance',   'SNSN-LUX'),
        ('demo-env-soil',     'Demo Soil Sensor',    'Soil Moisture', 'GENERIC-SOIL'),
        ('demo-env-air',      'Demo Air Monitor',    'Air Quality',   'SNAQ-01'),
        ('demo-env-weather',  'Demo Weather Station','Ecowitt WS90',  'SBWS-90CM'),
        ('demo-env-presence', 'Demo Presence',       'Presence Gen4', 'S4SN-PR'),
        ('demo-env-contact',  'Demo Door/Window',    'Door Contact',  'SBDW-002C'),
        ('demo-env-flood',    'Demo Flood',          'Flood Sensor',  'GENERIC-FLOOD'),
        ('demo-env-smoke',    'Demo Smoke',          'Smoke Sensor',  'GENERIC-SMOKE'),
        ('demo-env-button',   'Demo Button',         'Button Sensor', 'GENERIC-BUTTON');

    CREATE TEMP TABLE _stale_environment_devices ON COMMIT DROP AS
    SELECT d.id
    FROM device.list d
    WHERE d.organization_id = v_org_id
      AND d.jdoc->>'source' = 'demo-seed-environment'
      AND NOT EXISTS (
          SELECT 1 FROM _desired_environment_devices wanted
          WHERE wanted.external_id = d.external_id
      );

    IF EXISTS (
        SELECT 1
        FROM device.list d
        JOIN _desired_environment_devices wanted ON wanted.external_id = d.external_id
        WHERE d.organization_id IS DISTINCT FROM v_org_id
           OR d.jdoc->>'source' IS DISTINCT FROM 'demo-seed-environment'
    ) THEN
        RAISE EXCEPTION 'Environment seed external_id collides with a non-seed device';
    END IF;

    -- Rebuild only telemetry owned by this seed set.
    SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
    DELETE FROM device_sensor.numeric_15min WHERE device IN (
        SELECT d.id FROM device.list d
        WHERE d.organization_id = v_org_id
          AND d.jdoc->>'source' = 'demo-seed-environment');
    DELETE FROM device_sensor.events WHERE device IN (
        SELECT d.id FROM device.list d
        WHERE d.organization_id = v_org_id
          AND d.jdoc->>'source' = 'demo-seed-environment');

    DELETE FROM organization.group_members gm
    USING _stale_environment_devices stale
    WHERE gm.organization_id = v_org_id
      AND gm.subject_type = 'device' AND gm.device_id = stale.id;
    DELETE FROM organization.tag_assignments ta
    USING _stale_environment_devices stale
    WHERE ta.organization_id = v_org_id
      AND ta.subject_type = 'device' AND ta.device_id = stale.id;
    DELETE FROM organization.location_assignments la
    USING _stale_environment_devices stale
    WHERE la.organization_id = v_org_id
      AND la.subject_type = 'device' AND la.device_id = stale.id;
    UPDATE device.list d
    SET jdoc = jsonb_set(d.jdoc, '{seed_active}', 'false'::jsonb, true),
        updated = now()
    FROM _stale_environment_devices stale
    WHERE d.id = stale.id;

    -- One demo device per sensor family.
    INSERT INTO device.list AS existing
        (external_id, organization_id, control_access, updated, jdoc)
    SELECT d.ext, v_org_id, 3, now(),
        jsonb_build_object(
            'shellyID', d.ext, 'name', d.name, 'app', d.app,
            'source', 'demo-seed-environment', 'seed_active', true,
            'gen', 3, 'fw_ver', '1.4.0',
            'info', jsonb_build_object('id', d.ext, 'app', d.app, 'model',
                d.model, 'ver', '1.4.0', 'gen', 3,
                'mac', upper(replace(d.ext, '-', ''))),
            'status', '{}'::jsonb, 'settings', '{}'::jsonb)
    FROM _desired_environment_devices d(ext, name, model, app)
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        control_access = EXCLUDED.control_access,
        updated = EXCLUDED.updated,
        jdoc = EXCLUDED.jdoc
    WHERE existing.organization_id = v_org_id
      AND existing.jdoc->>'source' = 'demo-seed-environment';

    GET DIAGNOSTICS v_upserted = ROW_COUNT;
    IF v_upserted <> (SELECT count(*) FROM _desired_environment_devices) THEN
        RAISE EXCEPTION 'Environment seed ownership changed during upsert';
    END IF;

    -- device -> numeric kind -> channel -> reading source
    CREATE TEMP TABLE _envmap(ext text, kind text, chan smallint, src text) ON COMMIT DROP;
    INSERT INTO _envmap VALUES
        ('demo-env-climate', 'temperature', 0, 'builtin'),
        ('demo-env-climate', 'temperature', 1, 'builtin'),
        ('demo-env-climate', 'humidity',    0, 'builtin'),
        ('demo-env-climate', 'dewpoint',    0, 'builtin'),
        ('demo-env-light',   'illuminance', 0, 'builtin'),
        ('demo-env-soil',    'moisture',    0, 'blu'),
        ('demo-env-soil',    'battery',     0, 'blu'),
        ('demo-env-air',     'co2',         0, 'builtin'),
        ('demo-env-air',     'tvoc',        0, 'builtin'),
        ('demo-env-air',     'pm25',        0, 'builtin'),
        ('demo-env-air',     'pm10',        0, 'builtin'),
        ('demo-env-weather', 'pressure',       0, 'weather'),
        ('demo-env-weather', 'wind_speed',     0, 'weather'),
        ('demo-env-weather', 'wind_gust',      0, 'weather'),
        ('demo-env-weather', 'wind_direction', 0, 'weather'),
        ('demo-env-weather', 'precipitation',  0, 'weather'),
        ('demo-env-weather', 'uv',             0, 'weather');

    -- 15-minute numeric history. avg = sum_val / sample_count.
    INSERT INTO device_sensor.numeric_15min
        (bucket, device, source, kind, channel, sum_val, sample_count, min_val, max_val)
    SELECT gs.ts, dev.id, m.src, m.kind, m.chan,
           (v.avgv * v.sc)::double precision,
           v.sc,
           (v.avgv - v.spread)::double precision,
           (v.avgv + v.spread)::double precision
    FROM _envmap m
    JOIN device.list dev ON dev.external_id = m.ext
    CROSS JOIN generate_series(
        date_trunc('hour', now() - (v_days || ' days')::interval),
        now(), interval '15 minutes') gs(ts)
    CROSS JOIN LATERAL (
        SELECT
            CASE m.kind
                WHEN 'temperature' THEN
                    CASE WHEN m.chan = 1 THEN 30
                         ELSE 22 + 2 * sin((extract(hour from gs.ts) - 9) / 24.0 * 2 * pi()) + (random() - 0.5)
                    END
                WHEN 'humidity'    THEN 48 - 8 * sin((extract(hour from gs.ts) - 9) / 24.0 * 2 * pi()) + (random() - 0.5) * 3
                WHEN 'dewpoint'    THEN 10 + (random() - 0.5) * 2
                WHEN 'illuminance' THEN greatest(0, 700 * sin(greatest(0, extract(hour from gs.ts) - 6) / 12.0 * pi())) + random() * 20
                WHEN 'moisture'    THEN 42 + (random() - 0.5) * 4
                WHEN 'battery'     THEN 88 + (random() - 0.5) * 4
                WHEN 'co2'         THEN 550 + 300 * abs(sin((extract(hour from gs.ts) - 9) / 24.0 * 2 * pi())) + random() * 80
                WHEN 'tvoc'        THEN 120 + random() * 100
                WHEN 'pm25'        THEN 9 + random() * 8
                WHEN 'pm10'        THEN 16 + random() * 12
                WHEN 'pressure'    THEN 1013 + 3 * sin(extract(epoch from gs.ts) / 86400.0) + (random() - 0.5)
                WHEN 'wind_speed'  THEN greatest(0, 3 + random() * 4)
                WHEN 'wind_gust'   THEN greatest(0, 5 + random() * 6)
                WHEN 'wind_direction' THEN (extract(hour from gs.ts) * 15 + random() * 30)::int % 360
                WHEN 'precipitation'  THEN greatest(0, (random() - 0.85) * 10)
                WHEN 'uv'          THEN greatest(0, 6 * sin(greatest(0, extract(hour from gs.ts) - 6) / 12.0 * pi()))
                ELSE 0
            END AS avgv,
            CASE m.kind
                WHEN 'temperature' THEN 0.4 WHEN 'humidity' THEN 1.5
                WHEN 'illuminance' THEN 40  WHEN 'co2' THEN 30
                WHEN 'pm25' THEN 2 WHEN 'pm10' THEN 3 WHEN 'pressure' THEN 0.5
                WHEN 'wind_speed' THEN 1 WHEN 'wind_gust' THEN 2 WHEN 'uv' THEN 0.5
                ELSE 1
            END AS spread,
            CASE m.kind
                WHEN 'battery' THEN 1 WHEN 'wind_gust' THEN 3
                WHEN 'wind_direction' THEN 3 WHEN 'precipitation' THEN 2
                ELSE (10 + floor(random() * 6))::int
            END AS sc
    ) v;

    -- Events. occupancy/motion during the day, door/window/button occasional.
    INSERT INTO device_sensor.events (ts, device, source, kind, channel, state)
    SELECT gs.ts, dev.id, 'blu', e.kind, 0,
           CASE WHEN e.kind = 'button' THEN (1 + floor(random() * 4))::int
                ELSE (random() > 0.5)::int END
    FROM (VALUES
        ('demo-env-presence', 'occupancy'),
        ('demo-env-presence', 'motion'),
        ('demo-env-contact',  'door'),
        ('demo-env-contact',  'window'),
        ('demo-env-button',   'button')
    ) e(ext, kind)
    JOIN device.list dev ON dev.external_id = e.ext
    CROSS JOIN generate_series(
        date_trunc('hour', now() - (v_days || ' days')::interval),
        now(), interval '90 minutes') gs(ts)
    WHERE (e.kind IN ('occupancy', 'motion')
              AND extract(hour from gs.ts) BETWEEN 7 AND 22 AND random() > 0.35)
       OR (e.kind IN ('door', 'window') AND random() > 0.85)
       OR (e.kind = 'button' AND random() > 0.9);

    -- Baseline events keep every event-only demo device visible.
    INSERT INTO device_sensor.events (ts, device, source, kind, channel, state)
    SELECT now() - interval '1 hour', dev.id, 'blu', e.kind, 0, e.state
    FROM (VALUES
        ('demo-env-presence', 'occupancy', 0),
        ('demo-env-presence', 'motion',    0),
        ('demo-env-contact',  'door',      0),
        ('demo-env-contact',  'window',    0),
        ('demo-env-flood',    'flood',     0),
        ('demo-env-smoke',    'smoke',     0),
        ('demo-env-button',   'button',    1)
    ) e(ext, kind, state)
    JOIN device.list dev ON dev.external_id = e.ext;

    RAISE NOTICE 'Seeded demo environment devices, 15-min history and events.';
END $plpgsql$;
