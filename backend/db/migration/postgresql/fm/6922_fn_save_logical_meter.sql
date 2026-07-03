--------------UP
-- Create (p_id NULL) or update one logical meter, then replace its point
-- set in the same transaction. Points arrive as a JSONB array so the
-- repository has one parameter instead of seven parallel arrays. Every
-- write is org-scoped: an update that matches no row in the caller's org
-- raises, so one organization can never edit another's meter.

CREATE OR REPLACE FUNCTION fm.fn_save_logical_meter(
    p_id BIGINT,
    p_org VARCHAR(120),
    p_name VARCHAR(128),
    p_utility_type VARCHAR(16),
    p_role VARCHAR(24),
    p_kind_id TEXT,
    p_phase_mode VARCHAR(24),
    p_aggregation_mode VARCHAR(16),
    p_parent_meter_id BIGINT,
    p_group_id INT,
    p_location_id INT,
    p_cost_center VARCHAR(120),
    p_virtual_formula JSONB,
    p_points JSONB
)
RETURNS BIGINT
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF p_id IS NULL THEN
        INSERT INTO fm.logical_meter (
            organization_id, name, utility_type, role, kind_id,
            phase_mode, aggregation_mode, parent_meter_id,
            group_id, location_id, cost_center, virtual_formula
        )
        VALUES (
            p_org, p_name, p_utility_type, p_role, p_kind_id,
            p_phase_mode, p_aggregation_mode, p_parent_meter_id,
            p_group_id, p_location_id, p_cost_center, p_virtual_formula
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE fm.logical_meter SET
            name = p_name,
            utility_type = p_utility_type,
            role = p_role,
            kind_id = p_kind_id,
            phase_mode = p_phase_mode,
            aggregation_mode = p_aggregation_mode,
            parent_meter_id = p_parent_meter_id,
            group_id = p_group_id,
            location_id = p_location_id,
            cost_center = p_cost_center,
            virtual_formula = p_virtual_formula,
            updated_at = now()
        WHERE id = p_id AND organization_id = p_org;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'logical_meter % not found for organization %', p_id, p_org;
        END IF;
        v_id := p_id;
    END IF;

    DELETE FROM fm.logical_meter_point WHERE logical_meter_id = v_id;

    -- Collapse to the (device, channel, tag) ownership grain: a meter's three
    -- phase points on one channel are the same phase-summed point, so store one
    -- row (the new UNIQUE would otherwise reject the 2nd/3rd). DISTINCT ON keeps
    -- the lowest phase deterministically; phase here is display metadata only.
    INSERT INTO fm.logical_meter_point (
        logical_meter_id, device, component_key, channel, phase,
        tag, electrical_domain, direction_hint
    )
    SELECT DISTINCT ON (
        (e->>'deviceId')::INT,
        COALESCE((e->>'channel')::SMALLINT, 0),
        e->>'tag'
    )
        v_id,
        (e->>'deviceId')::INT,
        e->>'componentKey',
        COALESCE((e->>'channel')::SMALLINT, 0),
        COALESCE(e->>'phase', 'z'),
        e->>'tag',
        e->>'electricalDomain',
        e->>'directionHint'
    FROM jsonb_array_elements(COALESCE(p_points, '[]'::jsonb)) AS e
    ORDER BY
        (e->>'deviceId')::INT,
        COALESCE((e->>'channel')::SMALLINT, 0),
        e->>'tag',
        COALESCE(e->>'phase', 'z');

    RETURN v_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_save_logical_meter(
    BIGINT, VARCHAR(120), VARCHAR(128), VARCHAR(16), VARCHAR(24), TEXT,
    VARCHAR(24), VARCHAR(16), BIGINT, INT, INT, VARCHAR(120), JSONB, JSONB
);
