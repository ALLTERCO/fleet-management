--------------UP
-- One-time backfill: copy each device's legacy role from device.asset_role into
-- device.list.catalog_kind (the catalog classification). asset_role lives in its
-- own table keyed by (organization_id, shelly_id), so each statement joins it to
-- device.list on (organization_id, external_id). Idempotent via
-- "catalog_kind IS NULL" — a re-run, or a device the user already classified by
-- hand, is left untouched. 'general' maps to nothing (unclassified stays NULL).
UPDATE device.list dl SET catalog_kind = m.catalog_kind
    FROM device.asset_role ar
    JOIN (VALUES
        ('service_entrance', 'main_meter'),
        ('submeter',         'submeter'),
        ('solar_pv',         'solar_array'),
        ('battery_bess',     'battery_bank'),
        ('ev_charger',       'ev_charging_station'),
        ('hvac',             'hvac_zone'),
        ('lighting',         'lighting_zone'),
        ('tenant',           'tenant'),
        ('transformer',      'distribution_transformer')
    ) AS m(asset_role, catalog_kind) ON m.asset_role = ar.asset_role
    WHERE ar.organization_id = dl.organization_id
      AND ar.shelly_id = dl.external_id
      AND dl.catalog_kind IS NULL;

--------------DOWN
-- No-op: a backfill can't be cleanly reversed. Without a provenance marker we
-- can't tell a value this migration wrote from one a user set by hand, so
-- clearing would risk wiping real classifications. Leave catalog_kind as-is.
SELECT 1;
