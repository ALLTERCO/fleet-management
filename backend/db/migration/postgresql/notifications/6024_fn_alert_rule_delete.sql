--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    DELETE FROM notifications.alert_rules
    WHERE notifications.alert_rules.id = p_id
      AND notifications.alert_rules.organization_id = p_organization_id
    RETURNING notifications.alert_rules.id;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_delete;
