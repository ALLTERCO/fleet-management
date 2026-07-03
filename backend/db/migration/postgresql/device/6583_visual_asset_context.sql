--------------UP
-- Per-asset origin tag so the picker can show "Recommended for this surface"
-- first. Free-typed string — new surfaces add their own context without a
-- schema migration. Existing rows default to 'general'.

ALTER TABLE device.visual_asset
    ADD COLUMN IF NOT EXISTS context VARCHAR(32) NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_visual_asset_org_context
    ON device.visual_asset(organization_id, context);

--------------DOWN
DROP INDEX IF EXISTS device.idx_visual_asset_org_context;
ALTER TABLE device.visual_asset DROP COLUMN IF EXISTS context;
