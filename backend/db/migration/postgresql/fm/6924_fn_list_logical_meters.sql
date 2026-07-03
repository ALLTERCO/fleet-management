--------------UP
-- List an org's logical meters with their points folded into one JSONB
-- array per meter, so the repository reads one row per meter (no N+1).
-- Optional group/location scope narrows the set; NULL = whole org.

CREATE OR REPLACE FUNCTION fm.fn_list_logical_meters(
    p_org VARCHAR(120),
    p_group_id INT DEFAULT NULL,
    p_location_id INT DEFAULT NULL
)
RETURNS TABLE (
    id               BIGINT,
    name             VARCHAR(128),
    utility_type     VARCHAR(16),
    role             VARCHAR(24),
    kind_id          TEXT,
    phase_mode       VARCHAR(24),
    aggregation_mode VARCHAR(16),
    parent_meter_id  BIGINT,
    group_id         INT,
    location_id      INT,
    cost_center      VARCHAR(120),
    virtual_formula  JSONB,
    points           JSONB
)
AS $$
    SELECT
        m.id,
        m.name,
        m.utility_type,
        m.role,
        m.kind_id,
        m.phase_mode,
        m.aggregation_mode,
        m.parent_meter_id,
        m.group_id,
        m.location_id,
        m.cost_center,
        m.virtual_formula,
        COALESCE(
            (
                SELECT jsonb_agg(jsonb_build_object(
                    'deviceId', p.device,
                    'componentKey', p.component_key,
                    'channel', p.channel,
                    'phase', p.phase,
                    'tag', p.tag,
                    'electricalDomain', p.electrical_domain,
                    'directionHint', p.direction_hint
                ) ORDER BY p.component_key, p.channel, p.phase)
                FROM fm.logical_meter_point p
                WHERE p.logical_meter_id = m.id
            ),
            '[]'::jsonb
        ) AS points
    FROM fm.logical_meter m
    WHERE m.organization_id = p_org
      AND (p_group_id IS NULL OR m.group_id = p_group_id)
      AND (p_location_id IS NULL OR m.location_id = p_location_id)
    ORDER BY m.name, m.id;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_list_logical_meters(VARCHAR(120), INT, INT);
