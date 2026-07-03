--------------UP
-- Mobile-specific overrides per item — null = use desktop fields capped to 1x1.
ALTER TABLE ui.dashboard_item ADD COLUMN mobile_layout JSONB;
--------------DOWN
ALTER TABLE ui.dashboard_item DROP COLUMN mobile_layout;
