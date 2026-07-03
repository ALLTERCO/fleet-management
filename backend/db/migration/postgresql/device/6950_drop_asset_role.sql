--------------UP
-- Retire device.asset_role. catalog_kind is the single device classification
-- and device.list.cost_center holds the billing label. Backfill any row set
-- after the 6830 one-time backfill, then drop the table.

BEGIN;

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

UPDATE device.list dl SET cost_center = ar.cost_center
    FROM device.asset_role ar
    WHERE ar.organization_id = dl.organization_id
      AND ar.shelly_id = dl.external_id
      AND ar.cost_center IS NOT NULL
      AND dl.cost_center IS NULL;

-- LINT-IGNORE: additive-only — deliberate asset_role retirement migration.
DROP TABLE IF EXISTS device.asset_role;

COMMIT;

--------------DOWN
-- Recreate the table and rebuild it from device.list so the rollback is
-- lossless: catalog_kind maps back to its asset_role (custom kinds with no
-- role become 'general'); cost_center carries across.
BEGIN;

CREATE TABLE device.asset_role (
    organization_id VARCHAR(64) NOT NULL,
    shelly_id       VARCHAR(64) NOT NULL,
    asset_role      VARCHAR(32) NOT NULL DEFAULT 'general',
    cost_center     VARCHAR(120),
    created         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, shelly_id),
    CONSTRAINT asset_role_value_chk CHECK (asset_role IN (
        'service_entrance', 'submeter', 'solar_pv', 'battery_bess',
        'ev_charger', 'hvac', 'lighting', 'tenant', 'transformer', 'general'))
);

INSERT INTO device.asset_role (organization_id, shelly_id, asset_role, cost_center)
SELECT dl.organization_id, dl.external_id,
       COALESCE(m.asset_role, 'general'), dl.cost_center
    FROM device.list dl
    LEFT JOIN (VALUES
        ('main_meter',               'service_entrance'),
        ('submeter',                 'submeter'),
        ('solar_array',              'solar_pv'),
        ('battery_bank',             'battery_bess'),
        ('ev_charging_station',      'ev_charger'),
        ('hvac_zone',                'hvac'),
        ('lighting_zone',            'lighting'),
        ('tenant',                   'tenant'),
        ('distribution_transformer', 'transformer')
    ) AS m(catalog_kind, asset_role) ON m.catalog_kind = dl.catalog_kind
    WHERE dl.organization_id IS NOT NULL
      AND dl.external_id IS NOT NULL
      AND (dl.catalog_kind IS NOT NULL OR dl.cost_center IS NOT NULL)
    ON CONFLICT (organization_id, shelly_id) DO NOTHING;

COMMIT;
