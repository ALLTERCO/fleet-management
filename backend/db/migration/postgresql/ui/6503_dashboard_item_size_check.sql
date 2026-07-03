--------------UP
-- Normalise free-form sizes to the fixed enum, then enforce.
UPDATE ui.dashboard_item SET size = '1x1'
 WHERE size IS NULL
    OR size NOT IN ('1x1','2x1','2x2','1x2','4x1','4x2','4x4');
ALTER TABLE ui.dashboard_item ALTER COLUMN size SET NOT NULL;
ALTER TABLE ui.dashboard_item ALTER COLUMN size SET DEFAULT '1x1';
ALTER TABLE ui.dashboard_item
    ADD CONSTRAINT dashboard_item_size_chk
    CHECK (size IN ('1x1','2x1','2x2','1x2','4x1','4x2','4x4'));
--------------DOWN
ALTER TABLE ui.dashboard_item DROP CONSTRAINT IF EXISTS dashboard_item_size_chk;
ALTER TABLE ui.dashboard_item ALTER COLUMN size DROP DEFAULT;
ALTER TABLE ui.dashboard_item ALTER COLUMN size DROP NOT NULL;
