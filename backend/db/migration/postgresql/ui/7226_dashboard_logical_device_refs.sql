--------------UP
CREATE TABLE IF NOT EXISTS ui.dashboard_device_ref_state (
    dashboard_id INTEGER PRIMARY KEY
        REFERENCES ui.dashboard(id) ON DELETE CASCADE,
    peak_is_set BOOLEAN NOT NULL DEFAULT FALSE,
    pv_grid_is_set BOOLEAN NOT NULL DEFAULT FALSE,
    pv_generation_is_set BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_organization_id_id_unique
    ON ui.dashboard (organization_id, id);

CREATE TABLE IF NOT EXISTS ui.dashboard_device_ref (
    id BIGSERIAL PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL,
    dashboard_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('peak', 'pv_grid', 'pv_generation')),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    device_id INTEGER NOT NULL,
    channel INTEGER,
    CONSTRAINT dashboard_device_ref_dashboard_fk
        FOREIGN KEY (organization_id, dashboard_id)
        REFERENCES ui.dashboard (organization_id, id) ON DELETE CASCADE,
    CONSTRAINT dashboard_device_ref_device_fk
        FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE,
    UNIQUE (dashboard_id, role, ordinal)
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_device_ref_identity_unique
    ON ui.dashboard_device_ref (
        dashboard_id, role, device_id, COALESCE(channel, -1)
    );

INSERT INTO ui.dashboard_device_ref_state (
    dashboard_id, peak_is_set, pv_grid_is_set, pv_generation_is_set
)
SELECT dashboard_id,
       peak_device_ids IS NOT NULL,
       pv_grid_refs IS NOT NULL,
       pv_generation_refs IS NOT NULL
  FROM ui.dashboard_settings
ON CONFLICT (dashboard_id) DO UPDATE SET
    peak_is_set = EXCLUDED.peak_is_set,
    pv_grid_is_set = EXCLUDED.pv_grid_is_set,
    pv_generation_is_set = EXCLUDED.pv_generation_is_set;

INSERT INTO ui.dashboard_device_ref (
    organization_id, dashboard_id, role, ordinal, device_id, channel
)
SELECT dashboard.organization_id, s.dashboard_id, 'peak', item.ordinality - 1,
       d.id, NULL
  FROM ui.dashboard_settings s
  JOIN ui.dashboard dashboard ON dashboard.id = s.dashboard_id
 CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.peak_device_ids, '[]'))
     WITH ORDINALITY AS item(external_id, ordinality)
  JOIN device.list d
    ON d.organization_id = dashboard.organization_id
   AND d.external_id = item.external_id
ON CONFLICT DO NOTHING;

INSERT INTO ui.dashboard_device_ref (
    organization_id, dashboard_id, role, ordinal, device_id, channel
)
SELECT dashboard.organization_id, s.dashboard_id, role.name,
       item.ordinality - 1, d.id,
       CASE WHEN item.ref->'channel' = 'null'::jsonb THEN NULL
            ELSE (item.ref->>'channel')::INTEGER END
  FROM ui.dashboard_settings s
  JOIN ui.dashboard dashboard ON dashboard.id = s.dashboard_id
 CROSS JOIN LATERAL (VALUES
        ('pv_grid', COALESCE(s.pv_grid_refs, '[]'::jsonb)),
        ('pv_generation', COALESCE(s.pv_generation_refs, '[]'::jsonb))
  ) role(name, refs)
 CROSS JOIN LATERAL jsonb_array_elements(role.refs)
     WITH ORDINALITY AS item(ref, ordinality)
  JOIN device.list d
    ON d.organization_id = dashboard.organization_id
   AND d.external_id = item.ref->>'device'
ON CONFLICT DO NOTHING;

DO $$
DECLARE expected_count BIGINT;
DECLARE stored_count BIGINT;
BEGIN
    SELECT COALESCE(SUM(jsonb_array_length(peak_device_ids)), 0)
         + COALESCE(SUM(jsonb_array_length(pv_grid_refs)), 0)
         + COALESCE(SUM(jsonb_array_length(pv_generation_refs)), 0)
      INTO expected_count
      FROM ui.dashboard_settings;
    SELECT count(*) INTO stored_count FROM ui.dashboard_device_ref;
    IF expected_count <> stored_count THEN
        RAISE EXCEPTION 'dashboard settings contain unresolved device references';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_device_refs_json(
    p_dashboard_id INTEGER,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN p_role = 'peak' THEN
            jsonb_agg(to_jsonb(d.external_id) ORDER BY r.ordinal)
        ELSE
            jsonb_agg(
                jsonb_build_object('device', d.external_id, 'channel', r.channel)
                ORDER BY r.ordinal
            )
        END
      FROM ui.dashboard_device_ref r
      JOIN device.list d ON d.id = r.device_id
     WHERE r.dashboard_id = p_dashboard_id
       AND r.role = p_role;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_set_peak_devices(INT, JSONB);
CREATE FUNCTION ui.fn_dashboard_settings_set_peak_devices(
    p_dashboard_id INTEGER,
    p_peak_device_ids JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE expected_count INTEGER;
DECLARE stored_count INTEGER;
BEGIN
    INSERT INTO ui.dashboard_device_ref_state (dashboard_id, peak_is_set)
    VALUES (p_dashboard_id, p_peak_device_ids IS NOT NULL)
    ON CONFLICT (dashboard_id) DO UPDATE
       SET peak_is_set = EXCLUDED.peak_is_set;

    DELETE FROM ui.dashboard_device_ref
     WHERE dashboard_id = p_dashboard_id AND role = 'peak';

    SELECT jsonb_array_length(COALESCE(p_peak_device_ids, '[]'::jsonb))
      INTO expected_count;

    INSERT INTO ui.dashboard_device_ref (
        organization_id, dashboard_id, role, ordinal, device_id, channel
    )
    SELECT dashboard.organization_id, p_dashboard_id, 'peak',
           item.ordinality - 1, d.id, NULL
      FROM ui.dashboard dashboard
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p_peak_device_ids, '[]'))
         WITH ORDINALITY AS item(external_id, ordinality)
      JOIN device.list d
        ON d.organization_id = dashboard.organization_id
       AND d.external_id = item.external_id
     WHERE dashboard.id = p_dashboard_id;

    GET DIAGNOSTICS stored_count = ROW_COUNT;
    IF expected_count <> stored_count THEN
        RAISE EXCEPTION 'one or more peak devices do not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;

    UPDATE ui.dashboard_settings
       SET peak_device_ids = p_peak_device_ids,
           updated = CURRENT_TIMESTAMP
     WHERE dashboard_id = p_dashboard_id;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_set_pv(INT, VARCHAR, JSONB, JSONB);
CREATE FUNCTION ui.fn_dashboard_settings_set_pv(
    p_dashboard_id INTEGER,
    p_pv_mode VARCHAR(16),
    p_pv_grid_refs JSONB,
    p_pv_generation_refs JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE expected_count INTEGER;
DECLARE stored_count INTEGER;
BEGIN
    UPDATE ui.dashboard_settings
       SET pv_mode = p_pv_mode,
           pv_grid_refs = p_pv_grid_refs,
           pv_generation_refs = p_pv_generation_refs,
           updated = CURRENT_TIMESTAMP
     WHERE dashboard_id = p_dashboard_id;

    INSERT INTO ui.dashboard_device_ref_state (
        dashboard_id, pv_grid_is_set, pv_generation_is_set
    ) VALUES (
        p_dashboard_id,
        p_pv_grid_refs IS NOT NULL,
        p_pv_generation_refs IS NOT NULL
    )
    ON CONFLICT (dashboard_id) DO UPDATE SET
        pv_grid_is_set = EXCLUDED.pv_grid_is_set,
        pv_generation_is_set = EXCLUDED.pv_generation_is_set;

    DELETE FROM ui.dashboard_device_ref
     WHERE dashboard_id = p_dashboard_id
       AND role IN ('pv_grid', 'pv_generation');

    SELECT jsonb_array_length(COALESCE(p_pv_grid_refs, '[]'::jsonb))
         + jsonb_array_length(COALESCE(p_pv_generation_refs, '[]'::jsonb))
      INTO expected_count;

    INSERT INTO ui.dashboard_device_ref (
        organization_id, dashboard_id, role, ordinal, device_id, channel
    )
    SELECT dashboard.organization_id, p_dashboard_id, role.name,
           item.ordinality - 1, d.id,
           CASE WHEN item.ref->'channel' = 'null'::jsonb THEN NULL
                ELSE (item.ref->>'channel')::INTEGER END
      FROM ui.dashboard dashboard
     CROSS JOIN LATERAL (VALUES
            ('pv_grid', COALESCE(p_pv_grid_refs, '[]'::jsonb)),
            ('pv_generation', COALESCE(p_pv_generation_refs, '[]'::jsonb))
      ) role(name, refs)
     CROSS JOIN LATERAL jsonb_array_elements(role.refs)
         WITH ORDINALITY AS item(ref, ordinality)
      JOIN device.list d
        ON d.organization_id = dashboard.organization_id
       AND d.external_id = item.ref->>'device'
     WHERE dashboard.id = p_dashboard_id;

    GET DIAGNOSTICS stored_count = ROW_COUNT;
    IF expected_count <> stored_count THEN
        RAISE EXCEPTION 'one or more PV devices do not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_fetch(INT);
CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_fetch(p_dashboard_id INT)
RETURNS TABLE (
    id INT, dashboard_id INT, tariff DECIMAL(10,4), currency VARCHAR(10),
    default_range VARCHAR(20), refresh_interval INT, enabled_metrics JSONB,
    chart_settings JSONB, tariff_mode VARCHAR(20), day_rate DECIMAL(10,4),
    night_rate DECIMAL(10,4), day_start TIME, day_end TIME, tariff_id INT,
    peak_device_ids JSONB, pv_mode VARCHAR(16), pv_grid_refs JSONB,
    pv_generation_refs JSONB, tariff_timezone TEXT, tariff_windows JSONB,
    tariff_weekend_override JSONB, tariff_holidays JSONB,
    emission_factor_g_per_kwh DOUBLE PRECISION,
    emission_factor_mbm_g_per_kwh DOUBLE PRECISION,
    co2_budget_kg DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
    SELECT s.id, s.dashboard_id, s.tariff, s.currency, s.default_range,
           s.refresh_interval, s.enabled_metrics, s.chart_settings,
           s.tariff_mode, s.day_rate, s.night_rate, s.day_start, s.day_end,
           s.tariff_id,
           CASE WHEN state.peak_is_set THEN
               COALESCE(ui.fn_dashboard_device_refs_json(s.dashboard_id, 'peak'), '[]')
           END,
           s.pv_mode,
           CASE WHEN state.pv_grid_is_set THEN
               COALESCE(ui.fn_dashboard_device_refs_json(s.dashboard_id, 'pv_grid'), '[]')
           END,
           CASE WHEN state.pv_generation_is_set THEN
               COALESCE(ui.fn_dashboard_device_refs_json(s.dashboard_id, 'pv_generation'), '[]')
           END,
           s.tariff_timezone, s.tariff_windows, s.tariff_weekend_override,
           s.tariff_holidays, s.emission_factor_g_per_kwh,
           s.emission_factor_mbm_g_per_kwh, s.co2_budget_kg
      FROM ui.dashboard_settings s
      LEFT JOIN ui.dashboard_device_ref_state state
        ON state.dashboard_id = s.dashboard_id
     WHERE s.dashboard_id = p_dashboard_id;
$$;

--------------DOWN
UPDATE ui.dashboard_settings s SET
    peak_device_ids = CASE WHEN state.peak_is_set THEN
        COALESCE(ui.fn_dashboard_device_refs_json(s.dashboard_id, 'peak'), '[]') END,
    pv_grid_refs = CASE WHEN state.pv_grid_is_set THEN
        COALESCE(ui.fn_dashboard_device_refs_json(s.dashboard_id, 'pv_grid'), '[]') END,
    pv_generation_refs = CASE WHEN state.pv_generation_is_set THEN
        COALESCE(ui.fn_dashboard_device_refs_json(s.dashboard_id, 'pv_generation'), '[]') END
FROM ui.dashboard_device_ref_state state
WHERE state.dashboard_id = s.dashboard_id;

DROP FUNCTION IF EXISTS ui.fn_dashboard_device_refs_json(INTEGER, TEXT);
DROP TABLE IF EXISTS ui.dashboard_device_ref;
DROP TABLE IF EXISTS ui.dashboard_device_ref_state;
DROP INDEX IF EXISTS ui.dashboard_organization_id_id_unique;
