#!/usr/bin/env bash
# Synthetic energy devices + 30 days of hourly telemetry. Dev DB only.
# Idempotent — marker `jdoc.source = 'demo-seed-energy'` keys delete-then-insert.

set -euo pipefail

# Caller must export DB_CONTAINER, DB_USER, DB_NAME.
seed_energy_data() {
    local db_container="${1:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    local device_count="${FM_SEED_DEMO_DEVICE_COUNT:-50}"
    local days="${FM_SEED_DEMO_HISTORY_DAYS:-30}"

    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' | grep -qx "$db_container"; then
        info "[energy-seed] DB container ${db_container} not running — skipping."
        return 0
    fi

    info "[energy-seed] Seeding ${device_count} devices × ${days} days hourly telemetry..."
    # Unquoted heredoc so bash interpolates ${device_count}/${days}. Escape
    # the plpgsql $$ delimiters and any inner $1..$N as \$\$/\$N so bash
    # doesn't try to expand them.
    docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 <<SQL >/dev/null
DO \$plpgsql\$
DECLARE
    v_device_count INTEGER := ${device_count};
    v_days         INTEGER := ${days};
    v_org_id       VARCHAR(120);
    v_bld_ids      INTEGER[];
    v_bld_id       INTEGER;
    v_app          VARCHAR(20);
    v_ext_id       VARCHAR(50);
    v_i            INTEGER;
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

    -- Lift Timescale's default 100k decompression cap for this re-seed; the
    -- whole demo set (50 devs × 30d × hourly) can exceed it on later runs.
    SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
    DELETE FROM device_em.stats
    WHERE device IN (
        SELECT id FROM device.list WHERE jdoc->>'source' = 'demo-seed-energy'
    );
    DELETE FROM device.list WHERE jdoc->>'source' = 'demo-seed-energy';

    FOR v_i IN 1..v_device_count LOOP
        v_ext_id := 'demo-em-' || lpad(v_i::text, 3, '0');
        v_app := CASE v_i % 4
            WHEN 0 THEN 'em'
            WHEN 1 THEN 'em1'
            WHEN 2 THEN 'pm1'
            ELSE 'switch'
        END;
        v_bld_id := CASE
            WHEN array_length(v_bld_ids, 1) IS NULL THEN NULL
            ELSE v_bld_ids[1 + ((v_i - 1) % array_length(v_bld_ids, 1))]
        END;

        INSERT INTO device.list (external_id, organization_id, control_access, updated, jdoc)
        VALUES (
            v_ext_id,
            v_org_id,
            3,
            now(),
            jsonb_build_object(
                'shellyID',   v_ext_id,
                'name',       'Demo ' || upper(v_app) || ' ' || lpad(v_i::text, 3, '0'),
                'app',        v_app,
                'source',     'demo-seed-energy',
                'location_id', v_bld_id,
                'gen',        2,
                'fw_ver',     '1.4.0',
                'info', jsonb_build_object(
                    'id',    v_ext_id,
                    'app',   v_app,
                    'model', 'demo-em',
                    'ver',   '1.4.0',
                    'gen',   2,
                    'mac',   upper(replace(v_ext_id, '-', ''))
                ),
                'status',   '{}'::jsonb,
                'settings', '{}'::jsonb
            )
        );
    END LOOP;

    INSERT INTO device_em.stats (ts, device, tag, val)
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
        END AS val
    FROM device.list d
    CROSS JOIN generate_series(
        date_trunc('hour', now() - (v_days || ' days')::interval),
        date_trunc('hour', now()),
        interval '1 hour'
    ) gs(ts)
    CROSS JOIN unnest(ARRAY['total_act_energy', 'power', 'voltage', 'current']) t(tag)
    WHERE d.jdoc->>'source' = 'demo-seed-energy';

    RAISE NOTICE 'Seeded % demo devices with % days of hourly telemetry.', v_device_count, v_days;
END \$plpgsql\$;
SQL
    ok "[energy-seed] Devices + telemetry seeded."
}
