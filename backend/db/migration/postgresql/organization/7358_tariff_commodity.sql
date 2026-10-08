--------------UP
-- Bind every tariff to the quantity it prices. Defaults preserve every
-- existing electricity tariff without changing its meaning.
ALTER TABLE organization.tariff
    ADD COLUMN IF NOT EXISTS commodity VARCHAR(16) NOT NULL DEFAULT 'electricity',
    ADD COLUMN IF NOT EXISTS billed_unit VARCHAR(8) NOT NULL DEFAULT 'kWh';

ALTER TABLE organization.tariff
    ADD CONSTRAINT organization__tariff_commodity_unit CHECK (
        (commodity = 'electricity' AND billed_unit = 'kWh')
        OR (commodity = 'water' AND billed_unit IN ('m3', 'l'))
        OR (commodity = 'gas' AND billed_unit = 'm3')
        OR (commodity = 'heat' AND billed_unit = 'kWh')
    ),
    ADD CONSTRAINT organization__tariff_block_unit CHECK (
        blocks IS NULL OR blocks->>'unit' = billed_unit
    );

-- Keep the previous implementations available for the reversible wrappers.
ALTER FUNCTION organization.fn_tariff_upsert(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_upsert_v7357;
ALTER FUNCTION organization.fn_tariff_get(VARCHAR, INTEGER)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_get_v7357;
ALTER FUNCTION organization.fn_tariff_list(VARCHAR)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_list_v7353;

CREATE FUNCTION organization.fn_tariff_upsert(p_org VARCHAR, p_payload JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
BEGIN
    v_id := organization.fn_tariff_upsert_v7357(p_org, p_payload);
    UPDATE organization.tariff
       SET commodity = COALESCE(p_payload->>'commodity', 'electricity'),
           billed_unit = COALESCE(p_payload->>'billedUnit', 'kWh')
     WHERE id = v_id AND organization_id = p_org;
    RETURN v_id;
END;
$$;

CREATE FUNCTION organization.fn_tariff_get(p_org VARCHAR, p_id INTEGER)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
    SELECT organization.fn_tariff_get_v7357(p_org, p_id)
           || jsonb_build_object(
                  'commodity', t.commodity,
                  'billedUnit', t.billed_unit
              )
      FROM organization.tariff t
     WHERE t.id = p_id AND t.organization_id = p_org;
$$;

CREATE FUNCTION organization.fn_tariff_list(p_org VARCHAR)
RETURNS TABLE (
    id INTEGER,
    name VARCHAR,
    kind VARCHAR,
    currency VARCHAR,
    effective_from DATE,
    effective_to DATE,
    source_reference VARCHAR,
    commodity VARCHAR,
    billed_unit VARCHAR
)
LANGUAGE sql STABLE
AS $$
    SELECT t.id, t.name, t.kind, t.currency,
           t.effective_from, t.effective_to, t.source_reference,
           t.commodity, t.billed_unit
      FROM organization.tariff t
     WHERE t.organization_id = p_org
     ORDER BY t.name;
$$;

-- The commodity remains a tariff fact, not an assignment fact. The point
-- index includes tariff_id so different commodity tariffs may coexist at the
-- same scope. fn_tariff_assign replaces only the inherited commodity peer.
DROP INDEX IF EXISTS organization.organization__tariff_assignment_point;
CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_assignment_point
    ON organization.tariff_assignment (
        organization_id,
        scope_level,
        coalesce(dashboard_id, -1),
        coalesce(location_id, -1),
        coalesce(device_id, -1),
        coalesce(channel, -1),
        tariff_id
    ) NULLS NOT DISTINCT;

ALTER FUNCTION organization.fn_tariff_assign(VARCHAR, JSONB, BOOLEAN)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_assign_v7354;
ALTER FUNCTION organization.fn_tariff_list_assignments(VARCHAR)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_list_assignments_v7354;
ALTER FUNCTION organization.fn_tariff_resolve_assignments(VARCHAR, JSONB)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_tariff_resolve_assignments_v7354;
DROP FUNCTION IF EXISTS organization.fn_tariff_resolve_assignments(VARCHAR, JSONB);

CREATE FUNCTION organization.fn_tariff_assign(
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
BEGIN
    IF v_level NOT IN ('organization','location','dashboard','device','channel') THEN
        RAISE EXCEPTION 'unsupported tariff assignment scope %', v_level;
    END IF;
    SELECT t.commodity INTO v_commodity
      FROM organization.tariff t
     WHERE t.id = v_tariff AND t.organization_id = p_org;
    IF v_commodity IS NULL THEN
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

    DELETE FROM organization.tariff_assignment assignment
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

    INSERT INTO organization.tariff_assignment (
        organization_id, tariff_id, scope_level,
        dashboard_id, location_id, device_id, channel
    ) VALUES (
        p_org, v_tariff, v_level,
        v_dashboard, v_location, v_device_id, v_channel
    );
END;
$$;

CREATE FUNCTION organization.fn_tariff_list_assignments(p_org VARCHAR)
RETURNS TABLE (
    scope_level VARCHAR,
    dashboard_id INTEGER,
    location_id INTEGER,
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER,
    commodity VARCHAR,
    billed_unit VARCHAR
)
LANGUAGE sql STABLE
AS $$
    SELECT assignment.scope_level,
           assignment.dashboard_id,
           assignment.location_id,
           dl.external_id,
           assignment.channel,
           assignment.tariff_id,
           tariff.commodity,
           tariff.billed_unit
      FROM organization.tariff_assignment assignment
      JOIN organization.tariff tariff
        ON tariff.id = assignment.tariff_id
       AND tariff.organization_id = assignment.organization_id
      LEFT JOIN device.list dl
        ON dl.organization_id = assignment.organization_id
       AND dl.id = assignment.device_id
     WHERE assignment.organization_id = p_org
     ORDER BY assignment.scope_level, assignment.id;
$$;

CREATE FUNCTION organization.fn_tariff_resolve_assignments(
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
    commodity VARCHAR
)
LANGUAGE sql STABLE
AS $$
    WITH RECURSIVE requested AS (
        SELECT point.device_external_id,
               point.channel,
               COALESCE(point.commodity, 'electricity') AS commodity,
               dl.id AS device_id
          FROM jsonb_to_recordset(coalesce(p_points, '[]'::jsonb))
               AS point(device_external_id VARCHAR, channel SMALLINT, commodity VARCHAR)
          LEFT JOIN device.list dl
            ON dl.organization_id = p_org
           AND dl.external_id = point.device_external_id
           AND dl.deleted_at IS NULL
    ), assigned_locations AS (
        SELECT requested.device_external_id,
               requested.channel,
               requested.commodity,
               la.location_id
          FROM requested
          JOIN organization.location_assignments la
            ON la.organization_id = p_org
           AND la.subject_type = 'device'
           AND la.device_id = requested.device_id
        UNION
        SELECT requested.device_external_id,
               requested.channel,
               requested.commodity,
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
               assigned.commodity,
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
               tree.commodity,
               parent.id,
               parent.parent_location_id,
               tree.depth + 1
          FROM location_tree tree
          JOIN organization.locations parent
            ON parent.organization_id = p_org
           AND parent.id = tree.parent_location_id
         WHERE tree.depth < 64
    ), candidates AS (
        SELECT requested.device_external_id,
               requested.channel,
               requested.commodity,
               assignment.tariff_id,
               assignment.scope_level,
               NULL::INTEGER AS location_id,
               100 AS priority
          FROM requested
          JOIN organization.tariff_assignment assignment
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
          JOIN organization.tariff_assignment assignment
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
          JOIN organization.tariff_assignment assignment
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
          JOIN organization.tariff_assignment assignment
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
        SELECT nearest.device_external_id,
               nearest.channel,
               nearest.commodity,
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
        SELECT requested.device_external_id,
               requested.commodity,
               COUNT(assignment.id) AS override_count,
               COUNT(DISTINCT assignment.tariff_id) AS tariff_count,
               MIN(assignment.tariff_id) AS only_tariff
          FROM requested
          JOIN organization.tariff_assignment assignment
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
           requested.commodity
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
-- OPERATOR ACTION REQUIRED: export/archive non-electric tariffs before DOWN.
-- Non-electric tariffs cannot be represented by the restored schema. Remove
-- them before their assignments can be silently reinterpreted as electricity.
-- LINT-IGNORE: additive-only
DELETE FROM organization.tariff WHERE commodity <> 'electricity';

DROP FUNCTION IF EXISTS organization.fn_tariff_resolve_assignments(VARCHAR, JSONB);
ALTER FUNCTION organization.fn_tariff_resolve_assignments_v7354(VARCHAR, JSONB)
    RENAME TO fn_tariff_resolve_assignments;
DROP FUNCTION IF EXISTS organization.fn_tariff_list_assignments(VARCHAR);
ALTER FUNCTION organization.fn_tariff_list_assignments_v7354(VARCHAR)
    RENAME TO fn_tariff_list_assignments;
DROP FUNCTION IF EXISTS organization.fn_tariff_assign(VARCHAR, JSONB, BOOLEAN);
ALTER FUNCTION organization.fn_tariff_assign_v7354(VARCHAR, JSONB, BOOLEAN)
    RENAME TO fn_tariff_assign;

DROP INDEX IF EXISTS organization.organization__tariff_assignment_point;
CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_assignment_point
    ON organization.tariff_assignment (
        organization_id,
        scope_level,
        coalesce(dashboard_id, -1),
        coalesce(location_id, -1),
        coalesce(device_id, -1),
        coalesce(channel, -1)
    ) NULLS NOT DISTINCT;

DROP FUNCTION IF EXISTS organization.fn_tariff_list(VARCHAR);
ALTER FUNCTION organization.fn_tariff_list_v7353(VARCHAR)
    RENAME TO fn_tariff_list;
DROP FUNCTION IF EXISTS organization.fn_tariff_get(VARCHAR, INTEGER);
ALTER FUNCTION organization.fn_tariff_get_v7357(VARCHAR, INTEGER)
    RENAME TO fn_tariff_get;
DROP FUNCTION IF EXISTS organization.fn_tariff_upsert(VARCHAR, JSONB);
ALTER FUNCTION organization.fn_tariff_upsert_v7357(VARCHAR, JSONB)
    RENAME TO fn_tariff_upsert;

ALTER TABLE organization.tariff
    DROP CONSTRAINT IF EXISTS organization__tariff_block_unit,
    DROP CONSTRAINT IF EXISTS organization__tariff_commodity_unit,
    DROP COLUMN IF EXISTS billed_unit,
    DROP COLUMN IF EXISTS commodity;
