--------------UP
-- Phase 3: collapse ui_element to widget; CHECK enforces kind ↔ typed cols.
ALTER TABLE ui.dashboard_item DROP CONSTRAINT IF EXISTS dashboard_item_kind_chk;

UPDATE ui.dashboard_item SET kind = 'widget' WHERE kind = 'ui_element';

ALTER TABLE ui.dashboard_item
    ADD CONSTRAINT dashboard_item_kind_chk
    CHECK (kind IN ('device','entity','group','location','tag','action','widget'));

DELETE FROM ui.dashboard_item
 WHERE (kind = 'widget' AND widget_kind IS NULL)
    OR (kind = 'device' AND device_id IS NULL)
    OR (kind = 'entity' AND (device_id IS NULL OR entity_sub_id IS NULL))
    OR (kind = 'group' AND group_id IS NULL)
    OR (kind = 'location' AND location_id IS NULL)
    OR (kind = 'tag' AND tag_id IS NULL)
    OR (kind = 'action' AND action_id IS NULL);

ALTER TABLE ui.dashboard_item
    ADD CONSTRAINT dashboard_item_typed_chk CHECK (
        (kind = 'device' AND
            device_id IS NOT NULL AND entity_sub_id IS NULL AND
            group_id IS NULL AND location_id IS NULL AND tag_id IS NULL AND
            action_id IS NULL AND widget_kind IS NULL AND widget_config IS NULL)
     OR (kind = 'entity' AND
            device_id IS NOT NULL AND entity_sub_id IS NOT NULL AND
            group_id IS NULL AND location_id IS NULL AND tag_id IS NULL AND
            action_id IS NULL AND widget_kind IS NULL AND widget_config IS NULL)
     OR (kind = 'group' AND
            device_id IS NULL AND entity_sub_id IS NULL AND
            group_id IS NOT NULL AND location_id IS NULL AND tag_id IS NULL AND
            action_id IS NULL AND widget_kind IS NULL AND widget_config IS NULL)
     OR (kind = 'location' AND
            device_id IS NULL AND entity_sub_id IS NULL AND
            group_id IS NULL AND location_id IS NOT NULL AND tag_id IS NULL AND
            action_id IS NULL AND widget_kind IS NULL AND widget_config IS NULL)
     OR (kind = 'tag' AND
            device_id IS NULL AND entity_sub_id IS NULL AND
            group_id IS NULL AND location_id IS NULL AND tag_id IS NOT NULL AND
            action_id IS NULL AND widget_kind IS NULL AND widget_config IS NULL)
     OR (kind = 'action' AND
            device_id IS NULL AND entity_sub_id IS NULL AND
            group_id IS NULL AND location_id IS NULL AND tag_id IS NULL AND
            action_id IS NOT NULL AND widget_kind IS NULL AND widget_config IS NULL)
     OR (kind = 'widget' AND
            device_id IS NULL AND entity_sub_id IS NULL AND
            group_id IS NULL AND location_id IS NULL AND tag_id IS NULL AND
            action_id IS NULL AND widget_kind IS NOT NULL)
    );
--------------DOWN
ALTER TABLE ui.dashboard_item DROP CONSTRAINT IF EXISTS dashboard_item_typed_chk;
ALTER TABLE ui.dashboard_item DROP CONSTRAINT IF EXISTS dashboard_item_kind_chk;
UPDATE ui.dashboard_item SET kind = 'ui_element' WHERE kind = 'widget';
ALTER TABLE ui.dashboard_item
    ADD CONSTRAINT dashboard_item_kind_chk
    CHECK (kind IN ('device','entity','group','location','tag','action','ui_element'));
