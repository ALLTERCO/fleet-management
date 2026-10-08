--------------UP
-- Tariffs inherit through one physical hierarchy:
-- channel -> device -> nearest assigned location ancestor -> organization.
-- Dashboard assignments remain readable for legacy dashboards, but they are
-- deliberately excluded from the canonical physical-meter resolver.
ALTER TABLE organization.tariff_assignment
    ALTER COLUMN scope_level TYPE VARCHAR(16),
    ADD COLUMN IF NOT EXISTS location_id INTEGER;

DROP INDEX IF EXISTS organization.organization__tariff_assignment_point;
ALTER TABLE organization.tariff_assignment
    DROP CONSTRAINT tariff_assignment_scope_level_check,
    DROP CONSTRAINT tariff_assignment_target_valid,
    ADD CONSTRAINT tariff_assignment_scope_level_check CHECK (
        scope_level IN ('organization','location','dashboard','device','channel')
    ),
    ADD CONSTRAINT tariff_assignment_location_fk
        FOREIGN KEY (location_id)
        REFERENCES organization.locations(id) ON DELETE CASCADE,
    ADD CONSTRAINT tariff_assignment_target_valid CHECK (
        device_external_id IS NULL
        AND (
            (scope_level = 'organization' AND dashboard_id IS NULL
                AND location_id IS NULL AND device_id IS NULL
                AND channel IS NULL)
            OR
            (scope_level = 'location' AND dashboard_id IS NULL
                AND location_id IS NOT NULL AND device_id IS NULL
                AND channel IS NULL)
            OR
            (scope_level = 'dashboard' AND dashboard_id IS NOT NULL
                AND location_id IS NULL AND device_id IS NULL
                AND channel IS NULL)
            OR
            (scope_level = 'device' AND dashboard_id IS NULL
                AND location_id IS NULL AND device_id IS NOT NULL
                AND channel IS NULL)
            OR
            (scope_level = 'channel' AND dashboard_id IS NULL
                AND location_id IS NULL AND device_id IS NOT NULL
                AND channel IS NOT NULL)
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_assignment_point
    ON organization.tariff_assignment (
        organization_id,
        scope_level,
        coalesce(dashboard_id, -1),
        coalesce(location_id, -1),
        coalesce(device_id, -1),
        coalesce(channel, -1)
    ) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION organization.fn_tariff_assign(
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
BEGIN
    IF v_level NOT IN ('organization','location','dashboard','device','channel') THEN
        RAISE EXCEPTION 'unsupported tariff assignment scope %', v_level;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM organization.tariff t
         WHERE t.id = v_tariff AND t.organization_id = p_org
    ) THEN
        RAISE EXCEPTION 'tariff % not in org %', v_tariff, p_org;
    END IF;
    IF v_level = 'location' AND NOT EXISTS (
        SELECT 1 FROM organization.locations l
         WHERE l.id = v_location AND l.organization_id = p_org
    ) THEN
        RAISE EXCEPTION 'location % not in org %', v_location, p_org;
    END IF;
    IF v_level IN ('device', 'channel') THEN
        v_device_id := organization.fn_resolve_device_id(p_org, v_external_id);
    END IF;

    IF p_delete THEN
        DELETE FROM organization.tariff_assignment assignment
         WHERE assignment.organization_id = p_org
           AND assignment.scope_level = v_level
           AND coalesce(assignment.dashboard_id, -1) = coalesce(v_dashboard, -1)
           AND coalesce(assignment.location_id, -1) = coalesce(v_location, -1)
           AND coalesce(assignment.device_id, -1) = coalesce(v_device_id, -1)
           AND coalesce(assignment.channel, -1) = coalesce(v_channel, -1);
        RETURN;
    END IF;

    INSERT INTO organization.tariff_assignment (
        organization_id, tariff_id, scope_level,
        dashboard_id, location_id, device_id, channel
    ) VALUES (
        p_org, v_tariff, v_level,
        v_dashboard, v_location, v_device_id, v_channel
    )
    ON CONFLICT (
        organization_id, scope_level, coalesce(dashboard_id, -1),
        coalesce(location_id, -1), coalesce(device_id, -1),
        coalesce(channel, -1)
    )
    DO UPDATE SET tariff_id = EXCLUDED.tariff_id;
END;
$$;

DROP FUNCTION IF EXISTS organization.fn_tariff_list_assignments(VARCHAR);
CREATE FUNCTION organization.fn_tariff_list_assignments(p_org VARCHAR)
RETURNS TABLE (
    scope_level VARCHAR,
    dashboard_id INTEGER,
    location_id INTEGER,
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER
)
LANGUAGE sql STABLE
AS $$
    SELECT assignment.scope_level,
           assignment.dashboard_id,
           assignment.location_id,
           dl.external_id,
           assignment.channel,
           assignment.tariff_id
      FROM organization.tariff_assignment assignment
      LEFT JOIN device.list dl
        ON dl.organization_id = assignment.organization_id
       AND dl.id = assignment.device_id
     WHERE assignment.organization_id = p_org
     ORDER BY assignment.scope_level, assignment.id;
$$;

-- Resolve every requested metering point in the database, where device and
-- location ownership live. A point with channel=NULL represents a whole-load
-- device. If that device has channel overrides pointing to different tariffs,
-- the result is explicitly ambiguous rather than silently falling back.
CREATE OR REPLACE FUNCTION organization.fn_tariff_resolve_assignments(
    p_org VARCHAR,
    p_points JSONB
)
RETURNS TABLE (
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER,
    scope_level VARCHAR,
    location_id INTEGER,
    ambiguous BOOLEAN
)
LANGUAGE sql STABLE
AS $$
    WITH RECURSIVE requested AS (
        SELECT point.device_external_id,
               point.channel,
               dl.id AS device_id
          FROM jsonb_to_recordset(coalesce(p_points, '[]'::jsonb))
               AS point(device_external_id VARCHAR, channel SMALLINT)
          LEFT JOIN device.list dl
            ON dl.organization_id = p_org
           AND dl.external_id = point.device_external_id
           AND dl.deleted_at IS NULL
    ), assigned_locations AS (
        SELECT requested.device_external_id,
               requested.channel,
               la.location_id
          FROM requested
          JOIN organization.location_assignments la
            ON la.organization_id = p_org
           AND la.subject_type = 'device'
           AND la.device_id = requested.device_id
        UNION
        SELECT requested.device_external_id,
               requested.channel,
               la.location_id
          FROM requested
          JOIN organization.group_members gm
            ON gm.organization_id = p_org
           AND gm.subject_type = 'device'
           AND gm.device_id = requested.device_id
          JOIN organization.location_assignments la
            ON la.organization_id = p_org
           AND la.subject_type = 'group'
           AND la.subject_id = gm.group_id::TEXT
    ), location_tree AS (
        SELECT assigned.device_external_id,
               assigned.channel,
               location.id,
               location.parent_location_id,
               0 AS depth
          FROM assigned_locations assigned
          JOIN organization.locations location
            ON location.organization_id = p_org
           AND location.id = assigned.location_id
        UNION ALL
        SELECT tree.device_external_id,
               tree.channel,
               parent.id,
               parent.parent_location_id,
               tree.depth + 1
          FROM location_tree tree
          JOIN organization.locations parent
            ON parent.organization_id = p_org
           AND parent.id = tree.parent_location_id
         WHERE tree.depth < 64
    )
    SELECT requested.device_external_id,
           requested.channel,
           CASE WHEN decision.ambiguous THEN NULL ELSE decision.tariff_id END,
           CASE WHEN decision.ambiguous THEN NULL ELSE decision.scope_level END,
           CASE WHEN decision.ambiguous THEN NULL ELSE decision.location_id END,
           decision.ambiguous
      FROM requested
      LEFT JOIN LATERAL (
          SELECT assignment.tariff_id
            FROM organization.tariff_assignment assignment
           WHERE assignment.organization_id = p_org
             AND assignment.scope_level = 'channel'
             AND assignment.device_id = requested.device_id
             AND assignment.channel = requested.channel
             AND requested.channel IS NOT NULL
           LIMIT 1
      ) channel_winner ON TRUE
      LEFT JOIN LATERAL (
          SELECT assignment.tariff_id
            FROM organization.tariff_assignment assignment
           WHERE assignment.organization_id = p_org
             AND assignment.scope_level = 'device'
             AND assignment.device_id = requested.device_id
           LIMIT 1
      ) device_winner ON TRUE
      LEFT JOIN LATERAL (
          SELECT min(assignment.tariff_id) AS tariff_id,
                 min(assignment.location_id) AS location_id,
                 count(DISTINCT assignment.tariff_id) > 1 AS conflict
            FROM location_tree tree
            JOIN organization.tariff_assignment assignment
              ON assignment.organization_id = p_org
             AND assignment.scope_level = 'location'
             AND assignment.location_id = tree.id
           WHERE tree.device_external_id = requested.device_external_id
             AND tree.channel IS NOT DISTINCT FROM requested.channel
             AND tree.depth = (
                 SELECT min(nearest.depth)
                   FROM location_tree nearest
                   JOIN organization.tariff_assignment nearest_assignment
                     ON nearest_assignment.organization_id = p_org
                    AND nearest_assignment.scope_level = 'location'
                    AND nearest_assignment.location_id = nearest.id
                  WHERE nearest.device_external_id = requested.device_external_id
                    AND nearest.channel IS NOT DISTINCT FROM requested.channel
             )
      ) location_winner ON TRUE
      LEFT JOIN LATERAL (
          SELECT assignment.tariff_id
            FROM organization.tariff_assignment assignment
           WHERE assignment.organization_id = p_org
             AND assignment.scope_level = 'organization'
             AND requested.device_id IS NOT NULL
           LIMIT 1
      ) organization_winner ON TRUE
      LEFT JOIN LATERAL (
          SELECT count(*) AS override_count,
                 count(DISTINCT assignment.tariff_id) AS tariff_count,
                 min(assignment.tariff_id) AS only_tariff
            FROM organization.tariff_assignment assignment
           WHERE assignment.organization_id = p_org
             AND assignment.scope_level = 'channel'
             AND assignment.device_id = requested.device_id
             AND requested.channel IS NULL
      ) channel_summary ON TRUE
      LEFT JOIN LATERAL (
          SELECT
              CASE
                  WHEN channel_winner.tariff_id IS NOT NULL
                      THEN channel_winner.tariff_id
                  WHEN device_winner.tariff_id IS NOT NULL
                      THEN device_winner.tariff_id
                  WHEN NOT coalesce(location_winner.conflict, FALSE)
                      AND location_winner.tariff_id IS NOT NULL
                      THEN location_winner.tariff_id
                  ELSE organization_winner.tariff_id
              END AS base_tariff_id,
              CASE
                  WHEN channel_winner.tariff_id IS NOT NULL THEN 'channel'
                  WHEN device_winner.tariff_id IS NOT NULL THEN 'device'
                  WHEN NOT coalesce(location_winner.conflict, FALSE)
                      AND location_winner.tariff_id IS NOT NULL THEN 'location'
                  WHEN organization_winner.tariff_id IS NOT NULL THEN 'organization'
                  ELSE NULL
              END::VARCHAR AS base_scope_level,
              CASE
                  WHEN device_winner.tariff_id IS NULL
                   AND location_winner.tariff_id IS NOT NULL
                   AND NOT coalesce(location_winner.conflict, FALSE)
                      THEN location_winner.location_id
                  ELSE NULL
              END AS base_location_id,
              (
                  channel_winner.tariff_id IS NULL
                  AND device_winner.tariff_id IS NULL
                  AND coalesce(location_winner.conflict, FALSE)
              ) AS base_ambiguous
      ) base ON TRUE
      LEFT JOIN LATERAL (
          SELECT base.base_tariff_id AS tariff_id,
                 base.base_scope_level AS scope_level,
                 base.base_location_id AS location_id,
                 (
                     base.base_ambiguous
                     OR (
                         requested.channel IS NULL
                         AND channel_summary.override_count > 0
                         AND (
                             base.base_tariff_id IS NULL
                             OR channel_summary.tariff_count > 1
                             OR channel_summary.only_tariff <> base.base_tariff_id
                         )
                     )
                 ) AS ambiguous
      ) decision ON TRUE;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_resolve_assignments(VARCHAR, JSONB);
DROP FUNCTION IF EXISTS organization.fn_tariff_list_assignments(VARCHAR);

CREATE FUNCTION organization.fn_tariff_list_assignments(p_org VARCHAR)
RETURNS TABLE (
    scope_level VARCHAR,
    dashboard_id INTEGER,
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER
)
LANGUAGE sql STABLE
AS $$
    SELECT assignment.scope_level,
           assignment.dashboard_id,
           dl.external_id,
           assignment.channel,
           assignment.tariff_id
      FROM organization.tariff_assignment assignment
      LEFT JOIN device.list dl
        ON dl.organization_id = assignment.organization_id
       AND dl.id = assignment.device_id
     WHERE assignment.organization_id = p_org;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_assign(
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
    v_external_id VARCHAR := p_payload->>'deviceExternalId';
    v_device_id INTEGER;
    v_channel SMALLINT := (p_payload->>'channel')::SMALLINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM organization.tariff t
         WHERE t.id = v_tariff AND t.organization_id = p_org
    ) THEN
        RAISE EXCEPTION 'tariff % not in org %', v_tariff, p_org;
    END IF;
    IF v_level IN ('device', 'channel') THEN
        v_device_id := organization.fn_resolve_device_id(p_org, v_external_id);
    END IF;
    IF p_delete THEN
        DELETE FROM organization.tariff_assignment assignment
         WHERE assignment.organization_id = p_org
           AND assignment.scope_level = v_level
           AND coalesce(assignment.dashboard_id, -1) = coalesce(v_dashboard, -1)
           AND coalesce(assignment.device_id, -1) = coalesce(v_device_id, -1)
           AND coalesce(assignment.channel, -1) = coalesce(v_channel, -1);
        RETURN;
    END IF;
    INSERT INTO organization.tariff_assignment (
        organization_id, tariff_id, scope_level,
        dashboard_id, device_id, channel
    ) VALUES (
        p_org, v_tariff, v_level, v_dashboard, v_device_id, v_channel
    )
    ON CONFLICT (
        organization_id, scope_level, coalesce(dashboard_id, -1),
        coalesce(device_id, -1), coalesce(channel, -1)
    )
    DO UPDATE SET tariff_id = EXCLUDED.tariff_id;
END;
$$;

DELETE FROM organization.tariff_assignment
 WHERE scope_level IN ('organization', 'location');

DROP INDEX IF EXISTS organization.organization__tariff_assignment_point;
ALTER TABLE organization.tariff_assignment
    DROP CONSTRAINT tariff_assignment_scope_level_check,
    DROP CONSTRAINT tariff_assignment_target_valid,
    DROP CONSTRAINT tariff_assignment_location_fk,
    DROP COLUMN location_id,
    ALTER COLUMN scope_level TYPE VARCHAR(10),
    ADD CONSTRAINT tariff_assignment_scope_level_check CHECK (
        scope_level IN ('dashboard','device','channel')
    ),
    ADD CONSTRAINT tariff_assignment_target_valid CHECK (
        device_external_id IS NULL
        AND (
            (scope_level = 'dashboard' AND dashboard_id IS NOT NULL
                AND device_id IS NULL AND channel IS NULL)
            OR
            (scope_level = 'device' AND dashboard_id IS NULL
                AND device_id IS NOT NULL AND channel IS NULL)
            OR
            (scope_level = 'channel' AND dashboard_id IS NULL
                AND device_id IS NOT NULL AND channel IS NOT NULL)
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_assignment_point
    ON organization.tariff_assignment (
        organization_id, scope_level, coalesce(dashboard_id, -1),
        coalesce(device_id, -1), coalesce(channel, -1)
    ) NULLS NOT DISTINCT;
