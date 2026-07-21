--------------UP
CREATE OR REPLACE FUNCTION ui.fn_dashboard_action_map_destination(
    p_organization_id VARCHAR,
    p_destination JSONB,
    p_to_external BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_mapped JSONB;
    v_text TEXT;
BEGIN
    IF jsonb_typeof(p_destination) = 'array' THEN
        SELECT COALESCE(
            jsonb_agg(
                ui.fn_dashboard_action_map_destination(
                    p_organization_id, item.value, p_to_external
                ) ORDER BY item.ordinality
            ),
            '[]'::jsonb
        )
          INTO v_mapped
          FROM jsonb_array_elements(p_destination)
               WITH ORDINALITY AS item(value, ordinality);
        RETURN v_mapped;
    END IF;

    v_text := p_destination #>> '{}';
    IF p_to_external AND jsonb_typeof(p_destination) = 'number'
       AND v_text ~ '^[0-9]+$'
       AND v_text::NUMERIC BETWEEN 1 AND 2147483647 THEN
        SELECT to_jsonb(d.external_id)
          INTO v_mapped
          FROM device.list d
         WHERE d.organization_id = p_organization_id
           AND d.id = v_text::INTEGER;
    ELSIF NOT p_to_external AND jsonb_typeof(p_destination) = 'string' THEN
        SELECT to_jsonb(d.id)
          INTO v_mapped
          FROM device.list d
         WHERE d.organization_id = p_organization_id
           AND d.external_id = v_text;
    END IF;

    RETURN COALESCE(v_mapped, p_destination);
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_action_map_udf(
    p_organization_id VARCHAR,
    p_udf JSONB,
    p_to_external BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_actions JSONB;
    v_mapped JSONB;
BEGIN
    IF jsonb_typeof(p_udf) = 'array' THEN
        v_actions := p_udf;
    ELSIF jsonb_typeof(p_udf->'actions') = 'array' THEN
        v_actions := p_udf->'actions';
    ELSE
        RETURN p_udf;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            CASE
                WHEN jsonb_typeof(step.value) = 'object'
                     AND step.value ? 'dst'
                THEN jsonb_set(
                    step.value,
                    '{dst}',
                    ui.fn_dashboard_action_map_destination(
                        p_organization_id,
                        step.value->'dst',
                        p_to_external
                    )
                )
                ELSE step.value
            END
            ORDER BY step.ordinality
        ),
        '[]'::jsonb
    )
      INTO v_mapped
      FROM jsonb_array_elements(v_actions)
           WITH ORDINALITY AS step(value, ordinality);

    IF jsonb_typeof(p_udf) = 'array' THEN
        RETURN v_mapped;
    END IF;
    RETURN jsonb_set(p_udf, '{actions}', v_mapped);
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_action_udf_to_logical(
    p_organization_id VARCHAR,
    p_udf JSONB
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT ui.fn_dashboard_action_map_udf(
        p_organization_id, p_udf, FALSE
    );
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_action_udf_to_external(
    p_organization_id VARCHAR,
    p_udf JSONB
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT ui.fn_dashboard_action_map_udf(
        p_organization_id, p_udf, TRUE
    );
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_action_target_external_ids(
    p_organization_id VARCHAR,
    p_device_ids INTEGER[]
)
RETURNS TABLE (device_id INTEGER, external_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT d.id, d.external_id
      FROM device.list d
     WHERE d.organization_id = p_organization_id
       AND d.id = ANY(COALESCE(p_device_ids, ARRAY[]::INTEGER[]));
$$;

UPDATE ui.dashboard_item_action action
   SET udf = ui.fn_dashboard_action_udf_to_logical(
       action.organization_id, action.udf
   )
 WHERE action.udf IS NOT NULL;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_action_add(
    p_organization_id VARCHAR,
    p_name VARCHAR,
    p_udf JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INT;
BEGIN
    INSERT INTO ui.dashboard_item_action (organization_id, name, udf)
    VALUES (
        p_organization_id,
        p_name,
        ui.fn_dashboard_action_udf_to_logical(p_organization_id, p_udf)
    )
    RETURNING id INTO r_id;
    RETURN r_id;
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_action_update(
    p_organization_id VARCHAR,
    p_id INT,
    p_name VARCHAR,
    p_udf JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    UPDATE ui.dashboard_item_action
       SET name = p_name,
           udf = ui.fn_dashboard_action_udf_to_logical(
               p_organization_id, p_udf
           )
     WHERE id = p_id
       AND organization_id = p_organization_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;

--------------DOWN
UPDATE ui.dashboard_item_action action
   SET udf = ui.fn_dashboard_action_udf_to_external(
       action.organization_id, action.udf
   )
 WHERE action.udf IS NOT NULL;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_action_add(
    p_organization_id VARCHAR,
    p_name VARCHAR,
    p_udf JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INT;
BEGIN
    INSERT INTO ui.dashboard_item_action (organization_id, name, udf)
    VALUES (p_organization_id, p_name, p_udf)
    RETURNING id INTO r_id;
    RETURN r_id;
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_action_update(
    p_organization_id VARCHAR,
    p_id INT,
    p_name VARCHAR,
    p_udf JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    UPDATE ui.dashboard_item_action
       SET name = p_name, udf = p_udf
     WHERE id = p_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_action_target_external_ids(
    VARCHAR, INTEGER[]
);
DROP FUNCTION IF EXISTS ui.fn_dashboard_action_udf_to_external(VARCHAR, JSONB);
DROP FUNCTION IF EXISTS ui.fn_dashboard_action_udf_to_logical(VARCHAR, JSONB);
DROP FUNCTION IF EXISTS ui.fn_dashboard_action_map_udf(VARCHAR, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS ui.fn_dashboard_action_map_destination(
    VARCHAR, JSONB, BOOLEAN
);
