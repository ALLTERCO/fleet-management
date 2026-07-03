--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_replace_destination_groups(
    p_organization_id        VARCHAR,
    p_rule_id                INTEGER,
    p_destination_group_ids  JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
    destination_group_id INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    requested_count INTEGER;
    valid_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM notifications.alert_rules r
        WHERE r.id = p_rule_id
          AND r.organization_id = p_organization_id
    ) THEN
        RETURN;
    END IF;

    SELECT COUNT(*)
    INTO requested_count
    FROM (
        SELECT DISTINCT (value)::TEXT::INTEGER AS destination_group_id
        FROM jsonb_array_elements(COALESCE(p_destination_group_ids, '[]'::jsonb))
    ) requested;

    SELECT COUNT(*)
    INTO valid_count
    FROM (
        SELECT DISTINCT d.id AS destination_group_id
        FROM jsonb_array_elements(COALESCE(p_destination_group_ids, '[]'::jsonb)) src(value)
        JOIN notifications.destination_groups d
          ON d.id = (src.value)::TEXT::INTEGER
         AND d.organization_id = p_organization_id
    ) valid_requested;

    IF requested_count <> valid_count THEN
        RAISE EXCEPTION 'one or more destination groups do not exist in organization'
            USING ERRCODE = '23503';
    END IF;

    DELETE FROM notifications.alert_rule_destination_groups
    WHERE rule_id = p_rule_id;

    INSERT INTO notifications.alert_rule_destination_groups (
        rule_id, destination_group_id
    )
    SELECT
        p_rule_id,
        valid_requested.destination_group_id
    FROM (
        SELECT DISTINCT d.id AS destination_group_id
        FROM jsonb_array_elements(COALESCE(p_destination_group_ids, '[]'::jsonb)) src(value)
        JOIN notifications.destination_groups d
          ON d.id = (src.value)::TEXT::INTEGER
         AND d.organization_id = p_organization_id
    ) valid_requested
    ORDER BY valid_requested.destination_group_id ASC;

    RETURN QUERY
    SELECT dg.destination_group_id
    FROM notifications.alert_rule_destination_groups dg
    WHERE dg.rule_id = p_rule_id
    ORDER BY dg.destination_group_id ASC;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_replace_destination_groups;
