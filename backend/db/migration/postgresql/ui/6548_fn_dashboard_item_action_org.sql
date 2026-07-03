--------------UP
-- Phase 3: action fns take organization_id. TS callers updated to pass it.
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_action_add(VARCHAR, JSONB);
CREATE FUNCTION ui.fn_dashboard_item_action_add(
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_udf             JSONB
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

DROP FUNCTION IF EXISTS ui.fn_dashboard_item_action_update(INT, VARCHAR, JSONB);
CREATE FUNCTION ui.fn_dashboard_item_action_update(
    p_organization_id VARCHAR,
    p_id              INT,
    p_name            VARCHAR,
    p_udf             JSONB
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

DROP FUNCTION IF EXISTS ui.fn_dashboard_item_action_remove(INT);
CREATE FUNCTION ui.fn_dashboard_item_action_remove(
    p_organization_id VARCHAR,
    p_id              INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    DELETE FROM ui.dashboard_item_action
     WHERE id = p_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_item_action_fetch();
CREATE FUNCTION ui.fn_dashboard_item_action_fetch(
    p_organization_id VARCHAR
)
RETURNS TABLE (id INT, name VARCHAR, udf JSONB)
LANGUAGE sql
AS $$
    SELECT id, name, udf
      FROM ui.dashboard_item_action
     WHERE organization_id = p_organization_id;
$$;

-- Drop orphan action rows (no dashboard references them, so phase 1 backfill
-- couldn't determine an org). LINT-IGNORE: additive-only
DELETE FROM ui.dashboard_item_action WHERE organization_id IS NULL;

ALTER TABLE ui.dashboard_item_action
    ALTER COLUMN organization_id SET NOT NULL;
--------------DOWN
ALTER TABLE ui.dashboard_item_action
    ALTER COLUMN organization_id DROP NOT NULL;
