--------------UP
-- The held-state scheduler needs the live state of one fingerprint. Its only
-- memory was an in-process map that the hold deletes when it fires, so a
-- sensor re-sending the same value wrote the instance back to pending and
-- started another hold. This read is the row itself, served by the partial
-- unique index on (rule_id, fingerprint) WHERE resolved_at IS NULL.
CREATE OR REPLACE FUNCTION notifications.fn_alert_open_instance_by_fingerprint(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint_v2  VARCHAR
)
RETURNS TABLE (
    id    INTEGER,
    state VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT ai.id, ai.state
      FROM notifications.alert_instances ai
     WHERE ai.organization_id = p_organization_id
       AND ai.rule_id = p_rule_id
       AND ai.fingerprint = p_fingerprint_v2
       AND ai.resolved_at IS NULL;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_open_instance_by_fingerprint(VARCHAR, INTEGER, VARCHAR);
