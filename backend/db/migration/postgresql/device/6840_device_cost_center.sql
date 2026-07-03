--------------UP
-- cost_center moves off device.asset_role onto device.list, next to
-- catalog_kind, so a device's billing label has the same home as its
-- classification. One-time backfill from the legacy table; Device.SetKind
-- writes it from here on. asset_role is retired separately once readers move.

-- VARCHAR(120) matches COST_CENTER_MAX_LENGTH in types/api/assetRole.ts, so the
-- DB enforces the same cap the app does (and the rollback column accepts it).
ALTER TABLE device.list ADD COLUMN IF NOT EXISTS cost_center VARCHAR(120);

UPDATE device.list dl SET cost_center = ar.cost_center
    FROM device.asset_role ar
    WHERE ar.organization_id = dl.organization_id
      AND ar.shelly_id = dl.external_id
      AND ar.cost_center IS NOT NULL
      AND dl.cost_center IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_list_cost_center
    ON device.list (organization_id, cost_center)
    WHERE cost_center IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS device.idx_device_list_cost_center;
ALTER TABLE device.list DROP COLUMN IF EXISTS cost_center;
