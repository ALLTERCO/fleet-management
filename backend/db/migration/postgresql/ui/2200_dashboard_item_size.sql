--------------UP
ALTER TABLE ui.dashboard_item ADD COLUMN IF NOT EXISTS size VARCHAR(3) DEFAULT '1x1';
--------------DOWN
ALTER TABLE ui.dashboard_item DROP COLUMN IF EXISTS size;