--------------UP
-- SoT for image binaries in the org. Resource decorations
-- (virtual_metadata.image_path, virtual_device.image_asset_id,
-- blu_device.image_asset_id, organization.groups.image_asset_id,
-- device.list.image_asset_id) all reference rows here by UUID.
-- Dedup by sha256 within the org so picking the same upload twice is free.
CREATE TABLE device.visual_asset (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id VARCHAR(120) NOT NULL
                    REFERENCES organization.profile(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,
    sha256          CHAR(64) NOT NULL,
    content_type    VARCHAR(64) NOT NULL,
    size_bytes      INTEGER NOT NULL CHECK (size_bytes > 0),
    label           VARCHAR(255),
    uploaded_by     VARCHAR(255),
    created         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS visual_asset_org_sha256
    ON device.visual_asset(organization_id, sha256);

CREATE INDEX IF NOT EXISTS visual_asset_org_created
    ON device.visual_asset(organization_id, created DESC);

-- Physical device override — no override column existed before, so the
-- stock product image (deviceLogo.ts) is the previous behavior.
ALTER TABLE device.list
    ADD COLUMN IF NOT EXISTS image_asset_id UUID
    REFERENCES device.visual_asset(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_device_list_image_asset
    ON device.list(image_asset_id)
    WHERE image_asset_id IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS idx_device_list_image_asset;
ALTER TABLE device.list DROP COLUMN IF EXISTS image_asset_id;
DROP TABLE IF EXISTS device.visual_asset;
