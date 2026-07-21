#!/usr/bin/env bash
# E2E extraction-host fixture — a Shelly Pro 3EM whose group:220 source the
# device-detail + extracted-device-promotion browser tests read and extract
# from. Written straight to the store like the energy/env demo devices; the
# shared Admin.ReconcileDevices call in _seed_telemetry_history then registers
# it into the running FM. Test environments only (the caller gates it).

# Fixture identity (host id, name, source key) is single-sourced here so the
# same override reaches both this producer and the CI browser job.
# shellcheck source=deploy/scripts/common/seed/_e2e_fixture_ids.sh
source "$(dirname "${BASH_SOURCE[0]}")/_e2e_fixture_ids.sh"

seed_e2e_extraction_host() {
    local db_container="${1:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    local host_external_id="$FM_E2E_EXTRACTION_HOST_EXTERNAL_ID"
    # Escape single quotes for the SQL string literal below (name allows spaces).
    local host_name="${FM_E2E_EXTRACTION_HOST_NAME//\'/\'\'}"

    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' \
        | grep -qx "$db_container"; then
        info "[e2e-host] DB container ${db_container} not running — skipping."
        return 0
    fi
    if [[ ! "$host_external_id" =~ ^[a-zA-Z0-9_.:-]{1,50}$ ]]; then
        error "[e2e-host] unsafe host external id: $host_external_id"
        return 1
    fi

    local org_id
    org_id="$(docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -tAc 'SELECT id FROM organization.profile ORDER BY created_at, id LIMIT 1;')"
    if [ -z "$org_id" ]; then
        error "[e2e-host] no organization exists yet — office seed must run first."
        return 1
    fi

    # The group:220 source built below is the fixture's structure; it must match
    # FM_E2E_EXTRACTION_SOURCE_KEY (_e2e_fixture_ids.sh) that the extraction test reads.
    if ! docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 >/dev/null <<SQL
WITH fixture AS (
    SELECT
        '${org_id}'::varchar AS organization_id,
        '${host_external_id}'::varchar AS external_id,
        jsonb_build_object(
            'shellyID', '${host_external_id}',
            'source', 'e2e-extracted-device-fixture',
            'info', jsonb_build_object(
                'id', '${host_external_id}',
                'name', '${host_name}',
                'model', 'SPEM-003CEBEU',
                'app', 'Shelly Pro 3EM',
                'ver', '1.4.0'
            ),
            'settings', jsonb_build_object(
                'group:220', jsonb_build_object('id', 220, 'name', 'E2E Water Heater'),
                'number:221', jsonb_build_object('id', 221, 'name', 'Temperature'),
                'boolean:222', jsonb_build_object('id', 222, 'name', 'Relay')
            ),
            'status', jsonb_build_object(
                'group:220', jsonb_build_object(
                    'id', 220,
                    'value', jsonb_build_array('number:221', 'boolean:222')
                ),
                'number:221', jsonb_build_object('value', 42.5),
                'boolean:222', jsonb_build_object('value', true)
            )
        ) AS jdoc
),
existing AS (
    SELECT d.id
      FROM device.list d, fixture f
     WHERE d.organization_id = f.organization_id
       AND d.external_id = f.external_id
       AND COALESCE(d.kind, 'physical') = 'physical'
     ORDER BY d.id LIMIT 1
),
updated AS (
    UPDATE device.list d
       SET control_access = 3, kind = 'physical', jdoc = f.jdoc, updated = NOW()
      FROM fixture f, existing e
     WHERE d.id = e.id
     RETURNING d.id
)
INSERT INTO device.list (external_id, organization_id, control_access, kind, jdoc)
SELECT f.external_id, f.organization_id, 3, 'physical', f.jdoc
  FROM fixture f
 WHERE NOT EXISTS (SELECT 1 FROM updated)
   AND NOT EXISTS (SELECT 1 FROM existing);
SQL
    then
        error "[e2e-host] failed to seed extraction host."
        return 1
    fi
    ok "[e2e-host] Extraction host seeded (${host_external_id})."
}
