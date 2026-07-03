--------------UP
-- Existing alert_instances_rule_fingerprint_active is partial (only
-- WHERE resolved_at IS NULL) so it misses resolved instances. Firing
-- history needs full rule_id coverage to join transitions efficiently.
CREATE INDEX alert_instances_by_rule
    ON notifications.alert_instances (rule_id, id);
--------------DOWN
DROP INDEX IF EXISTS notifications.alert_instances_by_rule;
