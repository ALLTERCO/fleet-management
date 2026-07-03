--------------UP
-- Phase 1: backfill typed columns from legacy. Idempotent.
UPDATE ui.dashboard_item
   SET device_id = item
 WHERE kind = 'device' AND device_id IS NULL;

UPDATE ui.dashboard_item
   SET device_id = item, entity_sub_id = sub_item
 WHERE kind = 'entity' AND device_id IS NULL;

UPDATE ui.dashboard_item
   SET group_id = item
 WHERE kind = 'group' AND group_id IS NULL;

UPDATE ui.dashboard_item
   SET action_id = item
 WHERE kind = 'action' AND action_id IS NULL;

-- Widget rows: parse sub_item JSON; phase 3 cleans NULL widget_kind.
UPDATE ui.dashboard_item
   SET widget_kind = COALESCE(NULLIF(sub_item::jsonb->>'id', ''), 'clock_widget'),
       widget_config = sub_item::jsonb
 WHERE kind = 'ui_element'
   AND widget_kind IS NULL
   AND sub_item IS NOT NULL
   AND sub_item LIKE '{%';

UPDATE ui.dashboard_item
   SET widget_kind = 'clock_widget'
 WHERE kind = 'ui_element' AND sub_item IS NULL AND widget_kind IS NULL;
--------------DOWN
SELECT 1;
