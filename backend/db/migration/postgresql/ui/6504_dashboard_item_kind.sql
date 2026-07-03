--------------UP
-- Public-API enum mirrored on each row. Internal columns `type` (int) and
-- `item` (int) stay for back-compat with v1 functions; the API serialiser
-- maps them to {kind, refId}.
ALTER TABLE ui.dashboard_item ADD COLUMN kind VARCHAR(20);
UPDATE ui.dashboard_item SET kind = CASE type
    WHEN 1 THEN 'device'
    WHEN 2 THEN 'entity'
    WHEN 3 THEN 'group'
    WHEN 4 THEN 'action'
    WHEN 5 THEN 'ui_element'
    ELSE 'ui_element'
END;
ALTER TABLE ui.dashboard_item ALTER COLUMN kind SET NOT NULL;
ALTER TABLE ui.dashboard_item
    ADD CONSTRAINT dashboard_item_kind_chk
    CHECK (kind IN ('device','entity','group','action','ui_element'));
CREATE INDEX dashboard_item_kind ON ui.dashboard_item (kind);
--------------DOWN
DROP INDEX IF EXISTS ui.dashboard_item_kind;
ALTER TABLE ui.dashboard_item DROP CONSTRAINT IF EXISTS dashboard_item_kind_chk;
ALTER TABLE ui.dashboard_item DROP COLUMN kind;
