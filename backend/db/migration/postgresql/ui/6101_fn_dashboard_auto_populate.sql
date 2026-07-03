--------------UP
CREATE OR REPLACE FUNCTION ui.fn_dashboard_auto_populate(
    p_dashboard_type VARCHAR(20),
    p_group_id INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
    v_devices JSONB;
BEGIN
    IF p_group_id IS NOT NULL THEN
        SELECT jsonb_agg(row_to_json(d))
        INTO v_devices
        FROM device.fn_groups_get(p_id := p_group_id) d;
    ELSE
        SELECT jsonb_agg(row_to_json(d))
        INTO v_devices
        FROM device.fn_groups_get(p_id := NULL) d;
    END IF;

    RETURN jsonb_build_object(
        'devices', COALESCE(v_devices, '[]'::jsonb),
        'dashboardType', p_dashboard_type,
        'groupId', p_group_id
    );
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_auto_populate;
