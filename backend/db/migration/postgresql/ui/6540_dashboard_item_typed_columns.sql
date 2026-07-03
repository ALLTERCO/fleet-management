--------------UP
-- Typed columns per kind. FKs cascade so deleted refs remove their items.
ALTER TABLE ui.dashboard_item
    ADD COLUMN device_id      INTEGER REFERENCES device.list(id)             ON DELETE CASCADE,
    ADD COLUMN entity_sub_id  VARCHAR(50),
    ADD COLUMN group_id       INTEGER REFERENCES organization.groups(id)     ON DELETE CASCADE,
    ADD COLUMN location_id    INTEGER REFERENCES organization.locations(id)  ON DELETE CASCADE,
    ADD COLUMN tag_id         INTEGER REFERENCES organization.tags(id)       ON DELETE CASCADE,
    ADD COLUMN action_id      INTEGER REFERENCES ui.dashboard_item_action(id) ON DELETE CASCADE,
    ADD COLUMN widget_kind    VARCHAR(50),
    ADD COLUMN widget_config  JSONB;

CREATE INDEX dashboard_item_device   ON ui.dashboard_item (device_id)   WHERE device_id   IS NOT NULL;
CREATE INDEX dashboard_item_group    ON ui.dashboard_item (group_id)    WHERE group_id    IS NOT NULL;
CREATE INDEX dashboard_item_location ON ui.dashboard_item (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX dashboard_item_tag      ON ui.dashboard_item (tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX dashboard_item_action_  ON ui.dashboard_item (action_id)   WHERE action_id   IS NOT NULL;
--------------DOWN
DROP INDEX IF EXISTS ui.dashboard_item_action_;
DROP INDEX IF EXISTS ui.dashboard_item_tag;
DROP INDEX IF EXISTS ui.dashboard_item_location;
DROP INDEX IF EXISTS ui.dashboard_item_group;
DROP INDEX IF EXISTS ui.dashboard_item_device;
ALTER TABLE ui.dashboard_item
    DROP COLUMN widget_config,
    DROP COLUMN widget_kind,
    DROP COLUMN action_id,
    DROP COLUMN tag_id,
    DROP COLUMN location_id,
    DROP COLUMN group_id,
    DROP COLUMN entity_sub_id,
    DROP COLUMN device_id;
