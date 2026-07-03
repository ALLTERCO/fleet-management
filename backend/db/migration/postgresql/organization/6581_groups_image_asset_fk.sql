--------------UP
-- Convert organization.groups.image_asset_id to UUID + FK on
-- device.visual_asset. ON DELETE SET NULL on asset removal.

ALTER TABLE organization.groups
    ALTER COLUMN image_asset_id TYPE UUID USING image_asset_id::uuid;

ALTER TABLE organization.groups
    ADD CONSTRAINT groups_image_asset_fk
    FOREIGN KEY (image_asset_id)
    REFERENCES device.visual_asset(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_image_asset
    ON organization.groups(image_asset_id)
    WHERE image_asset_id IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS organization.idx_groups_image_asset;
ALTER TABLE organization.groups
    DROP CONSTRAINT IF EXISTS groups_image_asset_fk;
ALTER TABLE organization.groups
    ALTER COLUMN image_asset_id TYPE VARCHAR(255) USING image_asset_id::text;
