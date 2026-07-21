#!/usr/bin/env bash
# Synthetic energy devices + 30 days of hourly telemetry. Dev DB only.
# Idempotent — device rows are stable; marker-owned telemetry is regenerated.

set -euo pipefail

# Caller must export DB_CONTAINER, DB_USER, DB_NAME.
_reconcile_energy_seed_data() {
    local db_container="${1:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    local device_count="${2:-${FM_SEED_DEMO_DEVICE_COUNT:-50}}"
    local days="${FM_SEED_DEMO_HISTORY_DAYS:-30}"

    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' | grep -qx "$db_container"; then
        info "[energy-seed] DB container ${db_container} not running — skipping."
        return 0
    fi

    if [ "$device_count" -eq 0 ]; then
        info "[energy-seed] Retiring standalone demo energy devices..."
    else
        info "[energy-seed] Seeding ${device_count} devices × ${days} days hourly telemetry..."
    fi
    # Unquoted heredoc so bash interpolates ${device_count}/${days}. Escape
    # the plpgsql $$ delimiters and any inner $1..$N as \$\$/\$N so bash
    # doesn't try to expand them.
    if ! docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 <<SQL >/dev/null
DO \$plpgsql\$
DECLARE
    v_device_count INTEGER := ${device_count};
    v_days         INTEGER := ${days};
    v_org_id       VARCHAR(120);
    v_bld_ids      INTEGER[];
    v_upserted     INTEGER;
BEGIN
    SELECT id INTO v_org_id
    FROM organization.profile
    ORDER BY created_at, id LIMIT 1;
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found — run office seed first.';
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::integer[]) INTO v_bld_ids
    FROM organization.locations
    WHERE organization_id = v_org_id AND kind = 'building';

    CREATE TEMP TABLE _desired_energy_devices (
        ordinal     INTEGER PRIMARY KEY,
        external_id VARCHAR(50) NOT NULL UNIQUE,
        app         VARCHAR(20) NOT NULL,
        building_id INTEGER
    ) ON COMMIT DROP;

    INSERT INTO _desired_energy_devices (ordinal, external_id, app, building_id)
    SELECT
        i,
        'demo-em-' || lpad(i::text, 3, '0'),
        CASE i % 4
            WHEN 0 THEN 'em'
            WHEN 1 THEN 'em1'
            WHEN 2 THEN 'pm1'
            ELSE 'switch'
        END,
        CASE
            WHEN array_length(v_bld_ids, 1) IS NULL THEN NULL
            ELSE v_bld_ids[1 + ((i - 1) % array_length(v_bld_ids, 1))]
        END
    FROM generate_series(1, v_device_count) AS i;

    CREATE TEMP TABLE _stale_energy_devices ON COMMIT DROP AS
    SELECT d.id
    FROM device.list d
    WHERE d.organization_id = v_org_id
      AND d.jdoc->>'source' = 'demo-seed-energy'
      AND NOT EXISTS (
          SELECT 1 FROM _desired_energy_devices wanted
          WHERE wanted.external_id = d.external_id
      );

    IF EXISTS (
        SELECT 1
        FROM device.list d
        JOIN _desired_energy_devices wanted ON wanted.external_id = d.external_id
        WHERE d.organization_id IS DISTINCT FROM v_org_id
           OR d.jdoc->>'source' IS DISTINCT FROM 'demo-seed-energy'
    ) THEN
        RAISE EXCEPTION 'Energy seed external_id collides with a non-seed device';
    END IF;

    -- Rebuild only telemetry owned by this seed set.
    SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
    DELETE FROM device_em.stats
    WHERE device IN (
        SELECT d.id
        FROM device.list d
        WHERE d.organization_id = v_org_id
          AND d.jdoc->>'source' = 'demo-seed-energy'
    );
    DELETE FROM device_em.energy_15min
    WHERE device IN (
        SELECT d.id
        FROM device.list d
        WHERE d.organization_id = v_org_id
          AND d.jdoc->>'source' = 'demo-seed-energy'
    );

    DELETE FROM organization.group_members gm
    USING _stale_energy_devices stale
    WHERE gm.organization_id = v_org_id
      AND gm.subject_type = 'device' AND gm.device_id = stale.id;
    DELETE FROM organization.tag_assignments ta
    USING _stale_energy_devices stale
    WHERE ta.organization_id = v_org_id
      AND ta.subject_type = 'device' AND ta.device_id = stale.id;
    DELETE FROM organization.location_assignments la
    USING _stale_energy_devices stale
    WHERE la.organization_id = v_org_id
      AND la.subject_type = 'device' AND la.device_id = stale.id;
    UPDATE device.list d
    SET jdoc = jsonb_set(d.jdoc, '{seed_active}', 'false'::jsonb, true),
        updated = now()
    FROM _stale_energy_devices stale
    WHERE d.id = stale.id;

    INSERT INTO device.list AS existing
        (external_id, organization_id, control_access, updated, jdoc)
    SELECT
        wanted.external_id,
        v_org_id,
        3,
        now(),
        jsonb_build_object(
            'shellyID',   wanted.external_id,
            'name',       'Demo ' || upper(wanted.app) || ' ' || lpad(wanted.ordinal::text, 3, '0'),
            'app',        wanted.app,
            'source',     'demo-seed-energy',
            'seed_active', true,
            'location_id', wanted.building_id,
            'gen',        2,
            'fw_ver',     '1.4.0',
            'info', jsonb_build_object(
                'id',    wanted.external_id,
                'app',   wanted.app,
                'model', 'demo-em',
                'ver',   '1.4.0',
                'gen',   2,
                'mac',   upper(replace(wanted.external_id, '-', ''))
            ),
            'status',   '{}'::jsonb,
            'settings', '{}'::jsonb
        )
    FROM _desired_energy_devices wanted
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        control_access = EXCLUDED.control_access,
        updated = EXCLUDED.updated,
        jdoc = EXCLUDED.jdoc
    WHERE existing.organization_id = v_org_id
      AND existing.jdoc->>'source' = 'demo-seed-energy';

    GET DIAGNOSTICS v_upserted = ROW_COUNT;
    IF v_upserted <> v_device_count THEN
        RAISE EXCEPTION 'Energy seed ownership changed during upsert';
    END IF;

    INSERT INTO device_em.stats
        (ts, device, tag, val, domain, phase, channel, source)
    SELECT
        gs.ts,
        d.id,
        t.tag,
        CASE t.tag
            -- 0.5–3.0 kWh per hour, scaled by id so devices look distinct
            WHEN 'total_act_energy' THEN
                ((500 + ((d.id * 17) % 2500))
                 * (0.6 + 0.8 * random()))::real
            -- Power follows a sine curve over the day + jitter
            WHEN 'power' THEN
                (200 + 800 * abs(sin((extract(hour from gs.ts) / 24.0) * 2 * pi()))
                 + random() * 200)::real
            -- Voltage 225–245 V with small jitter
            WHEN 'voltage' THEN (230 + random() * 15)::real
            -- Current proportional to power / voltage (~ P/U)
            WHEN 'current' THEN
                (1.0 + 3.0 * abs(sin((extract(hour from gs.ts) / 24.0) * 2 * pi()))
                 + random())::real
            ELSE 0::real
        END AS val,
        'ac_mains',
        'z',
        0,
        'demo_seed'
    FROM device.list d
    JOIN _desired_energy_devices wanted ON wanted.external_id = d.external_id
    CROSS JOIN generate_series(
        date_trunc('hour', now() - (v_days || ' days')::interval),
        date_trunc('hour', now()),
        interval '1 hour'
    ) gs(ts)
    CROSS JOIN unnest(ARRAY['total_act_energy', 'power', 'voltage', 'current']) t(tag);

    PERFORM device_em.fn_append_energy_15min(
        array_agg(stats.device ORDER BY stats.ts, stats.device, stats.tag),
        array_agg(stats.tag ORDER BY stats.ts, stats.device, stats.tag),
        array_agg(stats.domain ORDER BY stats.ts, stats.device, stats.tag),
        array_agg(stats.phase ORDER BY stats.ts, stats.device, stats.tag),
        array_agg(stats.channel ORDER BY stats.ts, stats.device, stats.tag),
        array_agg(extract(epoch FROM stats.ts)::BIGINT ORDER BY stats.ts, stats.device, stats.tag),
        array_agg(stats.val ORDER BY stats.ts, stats.device, stats.tag)
    )
    FROM device_em.stats stats
    JOIN device.list d ON d.id = stats.device
    WHERE d.organization_id = v_org_id
      AND d.jdoc->>'source' = 'demo-seed-energy'
      AND d.jdoc->>'seed_active' = 'true'
      AND stats.source = 'demo_seed'
    HAVING count(*) > 0;

    IF v_device_count = 0 THEN
        RAISE NOTICE 'Retired standalone demo energy devices.';
    ELSE
        RAISE NOTICE 'Seeded % demo devices with % days of hourly telemetry.', v_device_count, v_days;
    END IF;
END \$plpgsql\$;
SQL
    then
        return 1
    fi
    if [ "$device_count" -eq 0 ]; then
        ok "[energy-seed] Standalone demo energy devices retired."
    else
        ok "[energy-seed] Devices + telemetry seeded."
    fi
}

seed_energy_data() {
    _reconcile_energy_seed_data "${1:-}" \
        "${2:-${FM_SEED_DEMO_DEVICE_COUNT:-50}}"
}

retire_energy_seed_devices() {
    _reconcile_energy_seed_data "${1:-}" 0
}
