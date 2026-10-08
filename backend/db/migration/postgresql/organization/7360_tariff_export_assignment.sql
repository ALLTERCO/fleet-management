--------------UP
-- Export/feed-in pricing is a distinct assignment leg. It must never inherit
-- an import tariff implicitly: buy and sell contracts often differ.
CREATE TABLE IF NOT EXISTS organization.tariff_export_assignment_archive_7360 (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id VARCHAR(120) NOT NULL,
    tariff_id INTEGER NOT NULL,
    scope_level VARCHAR(16) NOT NULL,
    dashboard_id INTEGER,
    location_id INTEGER,
    device_id INTEGER,
    channel SMALLINT,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_export_archive_point
    ON organization.tariff_export_assignment_archive_7360 (
        organization_id, tariff_id, scope_level,
        coalesce(dashboard_id, -1), coalesce(location_id, -1),
        coalesce(device_id, -1), coalesce(channel, -1)
    ) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS organization.tariff_export_assignment (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    tariff_id INTEGER NOT NULL
        REFERENCES organization.tariff(id) ON DELETE CASCADE,
    scope_level VARCHAR(16) NOT NULL CHECK (
        scope_level IN ('organization','location','dashboard','device','channel')
    ),
    dashboard_id INTEGER,
    location_id INTEGER REFERENCES organization.locations(id) ON DELETE CASCADE,
    device_id INTEGER,
    channel SMALLINT,
    CONSTRAINT tariff_export_assignment_device_fk
        FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE,
    CONSTRAINT tariff_export_assignment_target_valid CHECK (
        (scope_level = 'organization' AND dashboard_id IS NULL
            AND location_id IS NULL AND device_id IS NULL AND channel IS NULL)
        OR
        (scope_level = 'location' AND dashboard_id IS NULL
            AND location_id IS NOT NULL AND device_id IS NULL AND channel IS NULL)
        OR
        (scope_level = 'dashboard' AND dashboard_id IS NOT NULL
            AND location_id IS NULL AND device_id IS NULL AND channel IS NULL)
        OR
        (scope_level = 'device' AND dashboard_id IS NULL
            AND location_id IS NULL AND device_id IS NOT NULL AND channel IS NULL)
        OR
        (scope_level = 'channel' AND dashboard_id IS NULL
            AND location_id IS NULL AND device_id IS NOT NULL AND channel IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_export_assignment_point
    ON organization.tariff_export_assignment (
        organization_id, scope_level,
        coalesce(dashboard_id, -1), coalesce(location_id, -1),
        coalesce(device_id, -1), coalesce(channel, -1), tariff_id
    ) NULLS NOT DISTINCT;

-- Restore export assignments archived by DOWN. Rows whose parent tariff or
-- target was intentionally deleted while rolled back remain in the archive.
INSERT INTO organization.tariff_export_assignment (
    organization_id, tariff_id, scope_level,
    dashboard_id, location_id, device_id, channel
)
SELECT archive.organization_id, archive.tariff_id, archive.scope_level,
       archive.dashboard_id, archive.location_id, archive.device_id,
       archive.channel
  FROM organization.tariff_export_assignment_archive_7360 archive
  JOIN organization.tariff tariff
    ON tariff.id = archive.tariff_id
   AND tariff.organization_id = archive.organization_id
  LEFT JOIN device.list device
    ON device.organization_id = archive.organization_id
   AND device.id = archive.device_id
  LEFT JOIN organization.locations location
    ON location.organization_id = archive.organization_id
   AND location.id = archive.location_id
 WHERE (archive.device_id IS NULL OR device.id IS NOT NULL)
   AND (archive.location_id IS NULL OR location.id IS NOT NULL)
ON CONFLICT DO NOTHING;

DELETE FROM organization.tariff_export_assignment_archive_7360 archive
 WHERE EXISTS (
    SELECT 1
      FROM organization.tariff_export_assignment assignment
     WHERE assignment.organization_id = archive.organization_id
       AND assignment.tariff_id = archive.tariff_id
       AND assignment.scope_level = archive.scope_level
       AND assignment.dashboard_id IS NOT DISTINCT FROM archive.dashboard_id
       AND assignment.location_id IS NOT DISTINCT FROM archive.location_id
       AND assignment.device_id IS NOT DISTINCT FROM archive.device_id
       AND assignment.channel IS NOT DISTINCT FROM archive.channel
 );

CREATE OR REPLACE FUNCTION organization.fn_tariff_assign_export(
    p_org VARCHAR,
    p_payload JSONB,
    p_delete BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_tariff INTEGER := (p_payload->>'tariffId')::INTEGER;
    v_level VARCHAR := p_payload->>'scopeLevel';
    v_dashboard INTEGER := (p_payload->>'dashboardId')::INTEGER;
    v_location INTEGER := (p_payload->>'locationId')::INTEGER;
    v_external_id VARCHAR := p_payload->>'deviceExternalId';
    v_device_id INTEGER;
    v_channel SMALLINT := (p_payload->>'channel')::SMALLINT;
    v_commodity VARCHAR;
    v_kind VARCHAR;
BEGIN
    IF v_level NOT IN ('organization','location','dashboard','device','channel') THEN
        RAISE EXCEPTION 'unsupported tariff assignment scope %', v_level;
    END IF;
    SELECT tariff.commodity, tariff.kind
      INTO v_commodity, v_kind
      FROM organization.tariff tariff
     WHERE tariff.id = v_tariff AND tariff.organization_id = p_org;
    IF v_commodity IS NULL THEN
        RAISE EXCEPTION 'tariff % not in org %', v_tariff, p_org;
    END IF;
    IF v_kind = 'block' THEN
        RAISE EXCEPTION 'a block tariff cannot price exported energy';
    END IF;
    IF v_level = 'location' AND NOT EXISTS (
        SELECT 1 FROM organization.locations location
         WHERE location.id = v_location AND location.organization_id = p_org
    ) THEN
        RAISE EXCEPTION 'location % not in org %', v_location, p_org;
    END IF;
    IF v_level IN ('device', 'channel') THEN
        v_device_id := organization.fn_resolve_device_id(p_org, v_external_id);
    END IF;

    DELETE FROM organization.tariff_export_assignment assignment
    USING organization.tariff assigned_tariff
     WHERE assignment.organization_id = p_org
       AND assignment.scope_level = v_level
       AND coalesce(assignment.dashboard_id, -1) = coalesce(v_dashboard, -1)
       AND coalesce(assignment.location_id, -1) = coalesce(v_location, -1)
       AND coalesce(assignment.device_id, -1) = coalesce(v_device_id, -1)
       AND coalesce(assignment.channel, -1) = coalesce(v_channel, -1)
       AND assigned_tariff.id = assignment.tariff_id
       AND assigned_tariff.commodity = v_commodity;
    IF p_delete THEN RETURN; END IF;

    INSERT INTO organization.tariff_export_assignment (
        organization_id, tariff_id, scope_level,
        dashboard_id, location_id, device_id, channel
    ) VALUES (
        p_org, v_tariff, v_level,
        v_dashboard, v_location, v_device_id, v_channel
    );
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_list_export_assignments(p_org VARCHAR)
RETURNS TABLE (
    scope_level VARCHAR,
    dashboard_id INTEGER,
    location_id INTEGER,
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER,
    commodity VARCHAR,
    billed_unit VARCHAR,
    direction VARCHAR
)
LANGUAGE sql STABLE
AS $$
    SELECT assignment.scope_level,
           assignment.dashboard_id,
           assignment.location_id,
           device.external_id,
           assignment.channel,
           assignment.tariff_id,
           tariff.commodity,
           tariff.billed_unit,
           'export'::VARCHAR
      FROM organization.tariff_export_assignment assignment
      JOIN organization.tariff tariff
        ON tariff.id = assignment.tariff_id
       AND tariff.organization_id = assignment.organization_id
      LEFT JOIN device.list device
        ON device.organization_id = assignment.organization_id
       AND device.id = assignment.device_id
     WHERE assignment.organization_id = p_org
     ORDER BY assignment.scope_level, assignment.id;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_resolve_export_assignments(
    p_org VARCHAR,
    p_points JSONB
)
RETURNS TABLE (
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER,
    scope_level VARCHAR,
    location_id INTEGER,
    ambiguous BOOLEAN,
    commodity VARCHAR,
    direction VARCHAR
)
LANGUAGE sql STABLE
AS $$
    WITH RECURSIVE requested AS (
        SELECT point.device_external_id,
               point.channel,
               COALESCE(point.commodity, 'electricity') AS commodity,
               device.id AS device_id
          FROM jsonb_to_recordset(coalesce(p_points, '[]'::jsonb))
               AS point(device_external_id VARCHAR, channel SMALLINT, commodity VARCHAR)
          LEFT JOIN device.list device
            ON device.organization_id = p_org
           AND device.external_id = point.device_external_id
           AND device.deleted_at IS NULL
    ), assigned_locations AS (
        SELECT requested.device_external_id, requested.channel,
               requested.commodity, assignment.location_id
          FROM requested
          JOIN organization.location_assignments assignment
            ON assignment.organization_id = p_org
           AND assignment.subject_type = 'device'
           AND assignment.device_id = requested.device_id
        UNION
        SELECT requested.device_external_id, requested.channel,
               requested.commodity, assignment.location_id
          FROM requested
          JOIN organization.group_members member
            ON member.organization_id = p_org
           AND member.subject_type = 'device'
           AND member.device_id = requested.device_id
          JOIN organization.location_assignments assignment
            ON assignment.organization_id = p_org
           AND assignment.subject_type = 'group'
           AND assignment.subject_id = member.group_id::TEXT
    ), location_tree AS (
        SELECT assigned.device_external_id, assigned.channel,
               assigned.commodity, location.id,
               location.parent_location_id, 0 AS depth
          FROM assigned_locations assigned
          JOIN organization.locations location
            ON location.organization_id = p_org
           AND location.id = assigned.location_id
        UNION ALL
        SELECT tree.device_external_id, tree.channel, tree.commodity,
               parent.id, parent.parent_location_id, tree.depth + 1
          FROM location_tree tree
          JOIN organization.locations parent
            ON parent.organization_id = p_org
           AND parent.id = tree.parent_location_id
         WHERE tree.depth < 64
    ), candidates AS (
        SELECT requested.device_external_id, requested.channel,
               requested.commodity, assignment.tariff_id,
               assignment.scope_level, NULL::INTEGER AS location_id,
               100 AS priority
          FROM requested
          JOIN organization.tariff_export_assignment assignment
            ON assignment.organization_id = p_org
           AND assignment.scope_level = 'channel'
           AND assignment.device_id = requested.device_id
           AND assignment.channel = requested.channel
           AND requested.channel IS NOT NULL
          JOIN organization.tariff tariff
            ON tariff.id = assignment.tariff_id
           AND tariff.commodity = requested.commodity
        UNION ALL
        SELECT requested.device_external_id, requested.channel,
               requested.commodity, assignment.tariff_id,
               assignment.scope_level, NULL::INTEGER, 200
          FROM requested
          JOIN organization.tariff_export_assignment assignment
            ON assignment.organization_id = p_org
           AND assignment.scope_level = 'device'
           AND assignment.device_id = requested.device_id
          JOIN organization.tariff tariff
            ON tariff.id = assignment.tariff_id
           AND tariff.commodity = requested.commodity
        UNION ALL
        SELECT tree.device_external_id, tree.channel, tree.commodity,
               assignment.tariff_id, assignment.scope_level,
               assignment.location_id, 300 + tree.depth
          FROM location_tree tree
          JOIN organization.tariff_export_assignment assignment
            ON assignment.organization_id = p_org
           AND assignment.scope_level = 'location'
           AND assignment.location_id = tree.id
          JOIN organization.tariff tariff
            ON tariff.id = assignment.tariff_id
           AND tariff.commodity = tree.commodity
        UNION ALL
        SELECT requested.device_external_id, requested.channel,
               requested.commodity, assignment.tariff_id,
               assignment.scope_level, NULL::INTEGER, 10000
          FROM requested
          JOIN organization.tariff_export_assignment assignment
            ON assignment.organization_id = p_org
           AND assignment.scope_level = 'organization'
          JOIN organization.tariff tariff
            ON tariff.id = assignment.tariff_id
           AND tariff.commodity = requested.commodity
         WHERE requested.device_id IS NOT NULL
    ), nearest AS (
        SELECT device_external_id, channel, commodity, MIN(priority) AS priority
          FROM candidates
         GROUP BY device_external_id, channel, commodity
    ), base AS (
        SELECT nearest.device_external_id, nearest.channel, nearest.commodity,
               MIN(candidate.tariff_id) AS tariff_id,
               MIN(candidate.scope_level) AS scope_level,
               MIN(candidate.location_id) AS location_id,
               COUNT(DISTINCT candidate.tariff_id) > 1 AS ambiguous
          FROM nearest
          JOIN candidates candidate
            ON candidate.device_external_id = nearest.device_external_id
           AND candidate.channel IS NOT DISTINCT FROM nearest.channel
           AND candidate.commodity = nearest.commodity
           AND candidate.priority = nearest.priority
         GROUP BY nearest.device_external_id, nearest.channel, nearest.commodity
    ), channel_summary AS (
        SELECT requested.device_external_id, requested.commodity,
               COUNT(assignment.id) AS override_count,
               COUNT(DISTINCT assignment.tariff_id) AS tariff_count,
               MIN(assignment.tariff_id) AS only_tariff
          FROM requested
          JOIN organization.tariff_export_assignment assignment
            ON assignment.organization_id = p_org
           AND assignment.scope_level = 'channel'
           AND assignment.device_id = requested.device_id
          JOIN organization.tariff tariff
            ON tariff.id = assignment.tariff_id
           AND tariff.commodity = requested.commodity
         WHERE requested.channel IS NULL
         GROUP BY requested.device_external_id, requested.commodity
    )
    SELECT requested.device_external_id,
           requested.channel,
           CASE WHEN decision.ambiguous THEN NULL ELSE base.tariff_id END,
           CASE WHEN decision.ambiguous THEN NULL ELSE base.scope_level END,
           CASE WHEN decision.ambiguous THEN NULL ELSE base.location_id END,
           decision.ambiguous,
           requested.commodity,
           'export'::VARCHAR
      FROM requested
      LEFT JOIN base
        ON base.device_external_id = requested.device_external_id
       AND base.channel IS NOT DISTINCT FROM requested.channel
       AND base.commodity = requested.commodity
      LEFT JOIN channel_summary summary
        ON summary.device_external_id = requested.device_external_id
       AND summary.commodity = requested.commodity
      CROSS JOIN LATERAL (
          SELECT COALESCE(base.ambiguous, FALSE)
                 OR (
                     requested.channel IS NULL
                     AND COALESCE(summary.override_count, 0) > 0
                     AND (
                         base.tariff_id IS NULL
                         OR summary.tariff_count > 1
                         OR summary.only_tariff <> base.tariff_id
                     )
                 ) AS ambiguous
      ) decision;
$$;

--------------DOWN
-- Preserve configured export contracts before removing the live evaluator.
INSERT INTO organization.tariff_export_assignment_archive_7360 (
    organization_id, tariff_id, scope_level,
    dashboard_id, location_id, device_id, channel
)
SELECT organization_id, tariff_id, scope_level,
       dashboard_id, location_id, device_id, channel
  FROM organization.tariff_export_assignment
ON CONFLICT DO NOTHING;

DROP FUNCTION IF EXISTS organization.fn_tariff_resolve_export_assignments(VARCHAR, JSONB);
DROP FUNCTION IF EXISTS organization.fn_tariff_list_export_assignments(VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_tariff_assign_export(VARCHAR, JSONB, BOOLEAN);
DROP TABLE IF EXISTS organization.tariff_export_assignment;

-- The archive is intentionally retained. A subsequent UP restores every row
-- whose tariff and target still exist; no export assignment is relabelled as
-- import and rollback deletes no customer contract.
