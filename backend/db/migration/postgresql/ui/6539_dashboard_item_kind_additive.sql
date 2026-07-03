--------------UP
-- Phase 1: extend kind enum additively. Phase 3 collapses ui_element to widget.
ALTER TABLE ui.dashboard_item DROP CONSTRAINT IF EXISTS dashboard_item_kind_chk;
ALTER TABLE ui.dashboard_item
    ADD CONSTRAINT dashboard_item_kind_chk
    CHECK (kind IN ('device','entity','group','location','tag','action','ui_element','widget'));
--------------DOWN
ALTER TABLE ui.dashboard_item DROP CONSTRAINT IF EXISTS dashboard_item_kind_chk;
ALTER TABLE ui.dashboard_item
    ADD CONSTRAINT dashboard_item_kind_chk
    CHECK (kind IN ('device','entity','group','action','ui_element'));
