--------------UP
-- Convert device.virtual_metadata.image_path VARCHAR(255) to UUID + FK
-- on device.visual_asset(id). ON DELETE SET NULL on asset removal.
-- Operator runbook: tenants with legacy non-UUID image_path values must
-- run asset.MigrateImages BEFORE applying this migration. Same constraint
-- applies to the symmetric migration 6580 on virtual_device.image_asset_id.

-- Explicit transaction so a mid-migration failure (e.g. UUID cast rejects
-- a stray non-UUID value) rolls back the prior DROP DEFAULT — leaving the
-- table in its pre-migration shape, safe to re-run after the data fix.
BEGIN;

-- DEFAULT NULL on the VARCHAR column has type text; PG refuses to auto-cast
-- it to UUID, so drop it before the type change. Column nullability carries
-- the "absent = null" semantic on its own.
ALTER TABLE device.virtual_metadata
    ALTER COLUMN image_path DROP DEFAULT;

-- NULLIF defends against pre-existing empty strings that would fail the
-- UUID cast — convert them to NULL instead.
ALTER TABLE device.virtual_metadata
    ALTER COLUMN image_path TYPE UUID USING NULLIF(image_path, '')::uuid;

ALTER TABLE device.virtual_metadata
    ADD CONSTRAINT virtual_metadata_image_asset_fk
    FOREIGN KEY (image_path)
    REFERENCES device.visual_asset(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_virtual_metadata_image_asset
    ON device.virtual_metadata(image_path)
    WHERE image_path IS NOT NULL;

-- Recreate fn_virtual_meta_set with p_image_path UUID so INSERT/UPSERT
-- accepts the new column type without an explicit cast at the call site.
DROP FUNCTION IF EXISTS device.fn_virtual_meta_set(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TIMESTAMPTZ, VARCHAR, JSONB
);

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_set(
    p_organization_id VARCHAR,
    p_host_shelly_id  VARCHAR,
    p_component_key   VARCHAR,
    p_glyph           VARCHAR     DEFAULT NULL,
    p_color           VARCHAR     DEFAULT NULL,
    p_gradient        JSONB       DEFAULT NULL,
    p_promoted_at     TIMESTAMPTZ DEFAULT NULL,
    p_image_path      UUID        DEFAULT NULL,
    p_measurement     JSONB       DEFAULT NULL
)
RETURNS device.virtual_metadata
LANGUAGE plpgsql
AS $$
DECLARE
    v_row device.virtual_metadata;
BEGIN
    INSERT INTO device.virtual_metadata (
        organization_id, host_shelly_id, component_key,
        glyph, color, gradient, promoted_at, image_path, measurement
    )
    VALUES (
        p_organization_id, p_host_shelly_id, p_component_key,
        p_glyph, p_color, p_gradient, p_promoted_at, p_image_path, p_measurement
    )
    ON CONFLICT (organization_id, host_shelly_id, component_key) DO UPDATE
        SET glyph       = COALESCE(EXCLUDED.glyph,       device.virtual_metadata.glyph),
            color       = COALESCE(EXCLUDED.color,       device.virtual_metadata.color),
            gradient    = COALESCE(EXCLUDED.gradient,    device.virtual_metadata.gradient),
            promoted_at = COALESCE(EXCLUDED.promoted_at, device.virtual_metadata.promoted_at),
            image_path  = COALESCE(EXCLUDED.image_path,  device.virtual_metadata.image_path),
            measurement = COALESCE(EXCLUDED.measurement, device.virtual_metadata.measurement),
            updated     = CURRENT_TIMESTAMP
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

COMMIT;

--------------DOWN
BEGIN;

DROP FUNCTION IF EXISTS device.fn_virtual_meta_set(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TIMESTAMPTZ, UUID, JSONB
);
DROP INDEX IF EXISTS device.idx_virtual_metadata_image_asset;
ALTER TABLE device.virtual_metadata
    DROP CONSTRAINT IF EXISTS virtual_metadata_image_asset_fk;
ALTER TABLE device.virtual_metadata
    ALTER COLUMN image_path TYPE VARCHAR(255) USING image_path::text;
-- Restore the original DEFAULT NULL so the column matches the 2008 schema
-- exactly after a round-trip migration.
ALTER TABLE device.virtual_metadata
    ALTER COLUMN image_path SET DEFAULT NULL;

COMMIT;
