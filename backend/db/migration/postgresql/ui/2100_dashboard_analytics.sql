--------------UP
-- Add group_id and dashboard_type columns to support analytics dashboards
ALTER TABLE ui.dashboard
ADD COLUMN group_id INTEGER NULL REFERENCES device.groups(id) ON DELETE SET NULL,
ADD COLUMN dashboard_type VARCHAR(20) DEFAULT 'classic' CHECK (dashboard_type IN ('classic', 'analytics'));

-- Create index for group lookups
CREATE INDEX ui_dashboard_group_id ON ui.dashboard (group_id);

-- Add comment for documentation
COMMENT ON COLUMN ui.dashboard.group_id IS 'Reference to device group for analytics dashboards';
COMMENT ON COLUMN ui.dashboard.dashboard_type IS 'classic = widget-based, analytics = group-based with metrics';
--------------DOWN
DROP INDEX IF EXISTS ui_dashboard_group_id;
ALTER TABLE ui.dashboard DROP COLUMN IF EXISTS group_id;
ALTER TABLE ui.dashboard DROP COLUMN IF EXISTS dashboard_type;
