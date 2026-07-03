--------------UP
-- Free-form labels. labels_template carries the templated source
-- ({"region": "${device.region}"}); alert_instances.labels carries the
-- materialised result after the engine resolves the template against
-- the firing device.

ALTER TABLE notifications.alert_rules
    ADD COLUMN IF NOT EXISTS labels_template JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE notifications.alert_instances
    ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS alert_instances_labels_gin_idx
    ON notifications.alert_instances USING GIN (labels);

--------------DOWN
DROP INDEX IF EXISTS notifications.alert_instances_labels_gin_idx;
ALTER TABLE notifications.alert_instances DROP COLUMN IF EXISTS labels;
ALTER TABLE notifications.alert_rules DROP COLUMN IF EXISTS labels_template;
