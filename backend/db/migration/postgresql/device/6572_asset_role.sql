--------------UP
-- Per-device asset role: the friendliest one-field summary of "what does
-- this device do in the electrical system?". Drives role-gated report
-- metrics (demand charges need service_entrance, real solar self-consumption
-- needs solar_pv, etc.). Enum mirrored in src/types/api/assetRole.ts.

SET search_path TO device;

CREATE TABLE device.asset_role (
    organization_id VARCHAR(64) NOT NULL,
    shelly_id       VARCHAR(64) NOT NULL,
    asset_role      VARCHAR(32) NOT NULL DEFAULT 'general',
    cost_center     VARCHAR(120),
    created         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, shelly_id),
    CONSTRAINT asset_role_value_chk CHECK (asset_role IN (
        'service_entrance',
        'submeter',
        'solar_pv',
        'battery_bess',
        'ev_charger',
        'hvac',
        'lighting',
        'tenant',
        'transformer',
        'general'
    ))
);

CREATE INDEX IF NOT EXISTS idx_asset_role_org_role
    ON device.asset_role (organization_id, asset_role);

CREATE INDEX IF NOT EXISTS idx_asset_role_org_cost_center
    ON device.asset_role (organization_id, cost_center)
    WHERE cost_center IS NOT NULL;

--------------DOWN
SET search_path TO device;
DROP TABLE IF EXISTS device.asset_role;
