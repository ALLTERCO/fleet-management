--------------UP
ALTER TABLE organization.tariff_assignment ADD COLUMN IF NOT EXISTS device_id INTEGER;

COMMENT ON COLUMN organization.tariff_assignment.device_external_id IS
    'Deprecated API-era reference. Must remain NULL; device_id is authoritative.';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM organization.tariff_assignment assignment
          LEFT JOIN device.list dl
            ON dl.organization_id = assignment.organization_id
           AND dl.external_id = assignment.device_external_id
         WHERE assignment.scope_level IN ('device', 'channel')
           AND dl.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot migrate unresolved tariff device assignment';
    END IF;
END;
$$;

UPDATE organization.tariff_assignment assignment
   SET device_id = dl.id
  FROM device.list dl
 WHERE assignment.scope_level IN ('device', 'channel')
   AND dl.organization_id = assignment.organization_id
   AND dl.external_id = assignment.device_external_id;

DROP INDEX IF EXISTS organization.organization__tariff_assignment_point;
ALTER TABLE organization.tariff_assignment
    DROP CONSTRAINT tariff_assignment_check;

UPDATE organization.tariff_assignment
   SET device_external_id = NULL
 WHERE device_external_id IS NOT NULL;

ALTER TABLE organization.tariff_assignment
    ADD CONSTRAINT tariff_assignment_device_fk
        FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE CASCADE,
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
        organization_id,
        scope_level,
        coalesce(dashboard_id, -1),
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
    v_external_id VARCHAR := p_payload->>'deviceExternalId';
    v_device_id INTEGER;
    v_channel SMALLINT := (p_payload->>'channel')::SMALLINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM organization.tariff t
         WHERE t.id = v_tariff
           AND t.organization_id = p_org
    ) THEN
        RAISE EXCEPTION 'tariff % not in org %', v_tariff, p_org;
    END IF;

    IF v_level IN ('device', 'channel') THEN
        v_device_id := organization.fn_resolve_device_id(
            p_org, v_external_id
        );
    END IF;

    IF p_delete THEN
        DELETE FROM organization.tariff_assignment assignment
         WHERE assignment.organization_id = p_org
           AND assignment.scope_level = v_level
           AND coalesce(assignment.dashboard_id, -1)
               = coalesce(v_dashboard, -1)
           AND coalesce(assignment.device_id, -1)
               = coalesce(v_device_id, -1)
           AND coalesce(assignment.channel, -1)
               = coalesce(v_channel, -1);
        RETURN;
    END IF;

    INSERT INTO organization.tariff_assignment (
        organization_id, tariff_id, scope_level,
        dashboard_id, device_id, channel
    ) VALUES (
        p_org, v_tariff, v_level, v_dashboard, v_device_id, v_channel
    )
    ON CONFLICT (
        organization_id,
        scope_level,
        coalesce(dashboard_id, -1),
        coalesce(device_id, -1),
        coalesce(channel, -1)
    )
    DO UPDATE SET tariff_id = EXCLUDED.tariff_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_list_assignments(
    p_org VARCHAR
)
RETURNS TABLE (
    scope_level VARCHAR,
    dashboard_id INTEGER,
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER
)
LANGUAGE sql
STABLE
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

--------------DOWN
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
    v_channel SMALLINT := (p_payload->>'channel')::SMALLINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM organization.tariff t
         WHERE t.id = v_tariff AND t.organization_id = p_org
    ) THEN
        RAISE EXCEPTION 'tariff % not in org %', v_tariff, p_org;
    END IF;
    IF p_delete THEN
        DELETE FROM organization.tariff_assignment assignment
         WHERE assignment.organization_id = p_org
           AND assignment.scope_level = v_level
           AND coalesce(assignment.dashboard_id, -1)
               = coalesce(v_dashboard, -1)
           AND coalesce(assignment.device_external_id, '')
               = coalesce(v_external_id, '')
           AND coalesce(assignment.channel, -1)
               = coalesce(v_channel, -1);
        RETURN;
    END IF;
    INSERT INTO organization.tariff_assignment (
        organization_id, tariff_id, scope_level,
        dashboard_id, device_external_id, channel
    ) VALUES (
        p_org, v_tariff, v_level, v_dashboard, v_external_id, v_channel
    )
    ON CONFLICT (
        organization_id,
        scope_level,
        coalesce(dashboard_id, -1),
        coalesce(device_external_id, ''),
        coalesce(channel, -1)
    )
    DO UPDATE SET tariff_id = EXCLUDED.tariff_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_list_assignments(
    p_org VARCHAR
)
RETURNS TABLE (
    scope_level VARCHAR,
    dashboard_id INTEGER,
    device_external_id VARCHAR,
    channel SMALLINT,
    tariff_id INTEGER
)
LANGUAGE sql
STABLE
AS $$
    SELECT assignment.scope_level,
           assignment.dashboard_id,
           assignment.device_external_id,
           assignment.channel,
           assignment.tariff_id
      FROM organization.tariff_assignment assignment
     WHERE assignment.organization_id = p_org;
$$;

ALTER TABLE organization.tariff_assignment
    DROP CONSTRAINT tariff_assignment_target_valid;

UPDATE organization.tariff_assignment assignment
   SET device_external_id = dl.external_id
  FROM device.list dl
 WHERE dl.organization_id = assignment.organization_id
   AND dl.id = assignment.device_id;

DROP INDEX IF EXISTS organization.organization__tariff_assignment_point;
ALTER TABLE organization.tariff_assignment
    DROP CONSTRAINT tariff_assignment_device_fk,
    DROP COLUMN device_id,
    ADD CONSTRAINT tariff_assignment_check CHECK (
        (scope_level = 'dashboard' AND dashboard_id IS NOT NULL)
        OR
        (scope_level = 'device' AND device_external_id IS NOT NULL)
        OR
        (scope_level = 'channel' AND device_external_id IS NOT NULL
            AND channel IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS organization__tariff_assignment_point
    ON organization.tariff_assignment (
        organization_id,
        scope_level,
        coalesce(dashboard_id, -1),
        coalesce(device_external_id, ''),
        coalesce(channel, -1)
    ) NULLS NOT DISTINCT;

COMMENT ON COLUMN organization.tariff_assignment.device_external_id IS NULL;
