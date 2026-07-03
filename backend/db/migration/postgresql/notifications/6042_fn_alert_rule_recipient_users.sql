--------------UP
-- Return the distinct user ids that receive inbox items for a rule's
-- alerts: the union of every user-typed member across every destination
-- group referenced by the rule. Org-scoped so cross-org bleed is
-- impossible even if a caller passes the wrong rule id.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_recipient_users(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER
)
RETURNS TABLE (user_id VARCHAR)
LANGUAGE sql
AS $$
    SELECT DISTINCT m.member_id::VARCHAR AS user_id
    FROM notifications.alert_rule_destination_groups rdg
    JOIN notifications.destination_groups dg
      ON dg.id = rdg.destination_group_id
     AND dg.organization_id = p_organization_id
     AND dg.enabled = TRUE
    JOIN notifications.destination_group_members m
      ON m.destination_group_id = dg.id
     AND m.member_type = 'user'
    WHERE rdg.rule_id = p_rule_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_recipient_users;
