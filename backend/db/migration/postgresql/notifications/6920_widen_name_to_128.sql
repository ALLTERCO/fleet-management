--------------UP
-- Widen notification entity name columns to match the API NAME_SCHEMA (128).
ALTER TABLE notifications.alert_rules ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE notifications.destination_groups ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE notifications.integration_endpoints ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE notifications.channels ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE notifications.on_call_schedules ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE notifications.routing_policies ALTER COLUMN name TYPE VARCHAR(128);
--------------DOWN
ALTER TABLE notifications.alert_rules ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE notifications.destination_groups ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE notifications.integration_endpoints ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE notifications.channels ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE notifications.on_call_schedules ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE notifications.routing_policies ALTER COLUMN name TYPE VARCHAR(120);
