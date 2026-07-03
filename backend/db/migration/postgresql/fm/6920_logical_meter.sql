--------------UP
-- Logical meters are the energy meaning layer over device_em readings.
-- Facts (tag, phase, electrical domain) stay on measurement points.
--
-- role is scoped by utility_type via the composite CHECK below — an
-- electric meter is grid/pv/battery/…, a gas/water/heat meter is
-- supply/production/storage/usage/aux. The vocabularies have one home in
-- code (energyClassifier.ts for domain/phase, the API types for the
-- rest); these CHECKs are the DB-side mirror that fails loud on drift.

CREATE TABLE IF NOT EXISTS fm.logical_meter (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id  VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    name             VARCHAR(128) NOT NULL,
    utility_type     VARCHAR(16) NOT NULL,
    role             VARCHAR(24) NOT NULL,
    kind_id          TEXT NULL
        REFERENCES organization.kind(id) ON DELETE SET NULL,
    phase_mode       VARCHAR(24) NOT NULL DEFAULT 'unknown',
    aggregation_mode VARCHAR(16) NOT NULL,
    parent_meter_id  BIGINT NULL,
    group_id         INT NULL,
    location_id      INT NULL,
    cost_center      VARCHAR(120) NULL,
    virtual_formula  JSONB NULL,
    -- Provenance: 'user' (created via API) or 'dashboard_pv'
    -- (auto-migrated from a dashboard's legacy PV refs). Lets that one-time
    -- migration be reverted precisely.
    origin           VARCHAR(24) NOT NULL DEFAULT 'user',
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at       TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT logical_meter_utility_type_chk CHECK (utility_type IN (
        'electric', 'gas', 'water', 'heat'
    )),
    CONSTRAINT logical_meter_phase_mode_chk CHECK (phase_mode IN (
        'single_phase', 'three_phase', 'independent_channels', 'dc', 'unknown'
    )),
    CONSTRAINT logical_meter_aggregation_mode_chk CHECK (aggregation_mode IN (
        'sum_points', 'formula'
    )),
    -- Role is utility-scoped: electric uses energy-flow roles, the other
    -- utilities share supply/production/storage/usage/aux.
    CONSTRAINT logical_meter_role_chk CHECK (
        (utility_type = 'electric' AND role IN (
            'grid', 'pv', 'battery', 'generator', 'ev_charge', 'load', 'aux'
        ))
        OR (utility_type IN ('gas', 'water', 'heat') AND role IN (
            'supply', 'production', 'storage', 'usage', 'aux'
        ))
    ),
    -- A calculated meter carries a formula and no points; a physical meter
    -- carries points and no formula. The DB refuses the contradictory mix.
    CONSTRAINT logical_meter_formula_chk CHECK (
        (aggregation_mode = 'formula' AND virtual_formula IS NOT NULL)
        OR (aggregation_mode <> 'formula' AND virtual_formula IS NULL)
    ),
    -- Target for the org-scoped self-FK below (id alone is already unique).
    CONSTRAINT logical_meter_id_org_uq UNIQUE (id, organization_id),
    -- A parent meter must live in the same org as its child — the composite
    -- FK makes a cross-tenant parent impossible at the DB, not just in code.
    -- ON DELETE SET NULL (parent_meter_id) orphans children, never deletes
    -- them, and leaves their NOT NULL organization_id untouched (PG15+).
    CONSTRAINT logical_meter_parent_same_org_fk
        FOREIGN KEY (parent_meter_id, organization_id)
        REFERENCES fm.logical_meter (id, organization_id)
        ON DELETE SET NULL (parent_meter_id)
);

CREATE INDEX IF NOT EXISTS logical_meter_org_idx
    ON fm.logical_meter (organization_id);
CREATE INDEX IF NOT EXISTS logical_meter_parent_idx
    ON fm.logical_meter (parent_meter_id)
    WHERE parent_meter_id IS NOT NULL;

COMMENT ON TABLE fm.logical_meter IS
    'User/report metering objects over device_em readings — the meaning layer.';
COMMENT ON COLUMN fm.logical_meter.parent_meter_id IS
    'Topology: this meter is downstream of the parent; reports exclude children to avoid double counting.';
COMMENT ON COLUMN fm.logical_meter.virtual_formula IS
    'Formula for aggregation_mode=formula — sum of signed/shared meter terms.';

CREATE TABLE IF NOT EXISTS fm.meter_connection (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id    VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    meter_id           BIGINT NOT NULL,
    from_node          VARCHAR(48) NOT NULL,
    to_node            VARCHAR(48) NOT NULL,
    positive_direction VARCHAR(16) NOT NULL DEFAULT 'from_to',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meter_connection_meter_same_org_fk
        FOREIGN KEY (meter_id, organization_id)
        REFERENCES fm.logical_meter (id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT meter_connection_nodes_chk CHECK (
        from_node IN (
            'grid', 'ac_bus', 'house_load', 'pv_dc', 'inverter',
            'battery_dc', 'generator', 'thermal_loop', 'water_supply',
            'gas_supply'
        )
        AND to_node IN (
            'grid', 'ac_bus', 'house_load', 'pv_dc', 'inverter',
            'battery_dc', 'generator', 'thermal_loop', 'water_supply',
            'gas_supply'
        )
        AND from_node <> to_node
    ),
    CONSTRAINT meter_connection_positive_direction_chk CHECK (
        positive_direction IN ('from_to', 'to_from', 'bidirectional')
    ),
    CONSTRAINT meter_connection_unique UNIQUE (
        organization_id, meter_id, from_node, to_node
    )
);

CREATE INDEX IF NOT EXISTS meter_connection_org_idx
    ON fm.meter_connection (organization_id);
CREATE INDEX IF NOT EXISTS meter_connection_meter_idx
    ON fm.meter_connection (meter_id);

COMMENT ON TABLE fm.meter_connection IS
    'Optional topology edges for rich energy/resource flow views such as Sankey.';
COMMENT ON COLUMN fm.meter_connection.positive_direction IS
    'Direction that makes a positive meter value flow across this edge.';
--------------DOWN
DROP TABLE IF EXISTS fm.meter_connection;
DROP TABLE IF EXISTS fm.logical_meter;
