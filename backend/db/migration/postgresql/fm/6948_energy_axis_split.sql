--------------UP
-- Split AC/DC physics and generation/storage provenance out of the legacy
-- electrical_domain value without removing that rolling-deploy contract.

CREATE TABLE IF NOT EXISTS organization.energy_source (
    id              TEXT PRIMARY KEY,
    organization_id VARCHAR(120) NULL
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    description     TEXT NULL,
    attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS energy_source_org_slug_uq
    ON organization.energy_source (organization_id, slug)
    WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS energy_source_builtin_slug_uq
    ON organization.energy_source (slug)
    WHERE organization_id IS NULL;

INSERT INTO organization.energy_source
    (id, organization_id, slug, display_name, description)
VALUES
    ('grid', NULL, 'grid', 'Grid', 'Electricity supplied by a utility grid.'),
    ('solar', NULL, 'solar', 'Solar', 'Solar generation.'),
    ('wind', NULL, 'wind', 'Wind', 'Wind generation.'),
    ('hydro', NULL, 'hydro', 'Hydro', 'Hydroelectric generation.'),
    ('natural_gas', NULL, 'natural_gas', 'Natural gas', 'Natural-gas generation.'),
    ('oil', NULL, 'oil', 'Oil', 'Oil-fired generation.'),
    ('biomass', NULL, 'biomass', 'Biomass', 'Biomass generation.'),
    ('battery', NULL, 'battery', 'Battery', 'Energy discharged from storage.'),
    ('unspecified', NULL, 'unspecified', 'Unspecified', 'Source not yet declared.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE fm.logical_meter
    ADD COLUMN IF NOT EXISTS energy_source TEXT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'logical_meter_energy_source_fk'
          AND conrelid = 'fm.logical_meter'::regclass
    ) THEN
        ALTER TABLE fm.logical_meter
            ADD CONSTRAINT logical_meter_energy_source_fk
            FOREIGN KEY (energy_source)
            REFERENCES organization.energy_source(id) ON DELETE SET NULL;
    END IF;
END;
$$;

ALTER TABLE fm.logical_meter_point
    ADD COLUMN IF NOT EXISTS current_type VARCHAR(2) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'logical_meter_point_current_type_chk'
          AND conrelid = 'fm.logical_meter_point'::regclass
    ) THEN
        ALTER TABLE fm.logical_meter_point
            ADD CONSTRAINT logical_meter_point_current_type_chk
            CHECK (current_type IS NULL OR current_type IN ('ac', 'dc'));
    END IF;
END;
$$;

UPDATE fm.logical_meter_point
SET current_type = CASE
    WHEN electrical_domain = 'ac_mains' THEN 'ac'
    WHEN electrical_domain IN ('dc_pv', 'dc_battery', 'dc_bus') THEN 'dc'
    ELSE NULL
END
WHERE current_type IS NULL;

-- Preserve the provenance that was previously encoded in two legacy values.
-- AC mains and a generic DC bus do not prove a generation source.
UPDATE fm.logical_meter m
SET energy_source = CASE
    WHEN EXISTS (
        SELECT 1 FROM fm.logical_meter_point p
        WHERE p.logical_meter_id = m.id AND p.electrical_domain = 'dc_pv'
    ) THEN 'solar'
    WHEN EXISTS (
        SELECT 1 FROM fm.logical_meter_point p
        WHERE p.logical_meter_id = m.id AND p.electrical_domain = 'dc_battery'
    ) THEN 'battery'
    ELSE NULL
END
WHERE m.energy_source IS NULL
  AND EXISTS (
      SELECT 1 FROM fm.logical_meter_point p
      WHERE p.logical_meter_id = m.id
        AND p.electrical_domain IN ('dc_pv', 'dc_battery')
  );

-- Additive entry point: old application versions retain the original function.
CREATE OR REPLACE FUNCTION fm.fn_save_logical_meter_axes(
    p_id BIGINT,
    p_org VARCHAR(120),
    p_name VARCHAR(128),
    p_utility_type VARCHAR(16),
    p_role VARCHAR(24),
    p_kind_id TEXT,
    p_energy_source TEXT,
    p_phase_mode VARCHAR(24),
    p_aggregation_mode VARCHAR(16),
    p_parent_meter_id BIGINT,
    p_group_id INT,
    p_location_id INT,
    p_cost_center VARCHAR(120),
    p_virtual_formula JSONB,
    p_points JSONB
)
RETURNS BIGINT
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    v_id := fm.fn_save_logical_meter(
        p_id, p_org, p_name, p_utility_type, p_role, p_kind_id,
        p_phase_mode, p_aggregation_mode, p_parent_meter_id,
        p_group_id, p_location_id, p_cost_center, p_virtual_formula, p_points
    );

    UPDATE fm.logical_meter
    SET energy_source = p_energy_source
    WHERE id = v_id AND organization_id = p_org;

    UPDATE fm.logical_meter_point p
    SET current_type = COALESCE(
        NULLIF(e->>'currentType', ''),
        CASE
            WHEN e->>'electricalDomain' = 'ac_mains' THEN 'ac'
            WHEN e->>'electricalDomain' IN ('dc_pv', 'dc_battery', 'dc_bus')
                THEN 'dc'
            ELSE NULL
        END
    )
    FROM jsonb_array_elements(COALESCE(p_points, '[]'::jsonb)) AS e
    WHERE p.logical_meter_id = v_id
      AND p.device = (e->>'deviceId')::INT
      AND p.channel = COALESCE((e->>'channel')::SMALLINT, 0)
      AND p.tag = e->>'tag';

    RETURN v_id;
END;
$$
LANGUAGE plpgsql;

-- Bounded axis reader used beside the existing logical-meter list function.
-- One flat query reads every point and meter source; no per-meter queries.
CREATE OR REPLACE FUNCTION fm.fn_list_logical_meter_axes(
    p_org VARCHAR(120)
)
RETURNS TABLE (
    meter_id     BIGINT,
    energy_source TEXT,
    device       INT,
    channel      SMALLINT,
    tag          VARCHAR(30),
    current_type VARCHAR(2)
)
AS $$
    SELECT
        m.id,
        m.energy_source,
        p.device,
        p.channel,
        p.tag,
        p.current_type
    FROM fm.logical_meter m
    LEFT JOIN fm.logical_meter_point p ON p.logical_meter_id = m.id
    WHERE m.organization_id = p_org
    ORDER BY m.id, p.device, p.channel, p.tag;
$$
LANGUAGE sql;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_list_logical_meter_axes(VARCHAR(120));
DROP FUNCTION IF EXISTS fm.fn_save_logical_meter_axes(
    BIGINT, VARCHAR(120), VARCHAR(128), VARCHAR(16), VARCHAR(24), TEXT, TEXT,
    VARCHAR(24), VARCHAR(16), BIGINT, INT, INT, VARCHAR(120), JSONB, JSONB
);

ALTER TABLE fm.logical_meter_point
    DROP CONSTRAINT IF EXISTS logical_meter_point_current_type_chk;
ALTER TABLE fm.logical_meter_point DROP COLUMN IF EXISTS current_type;

ALTER TABLE fm.logical_meter
    DROP CONSTRAINT IF EXISTS logical_meter_energy_source_fk;
ALTER TABLE fm.logical_meter DROP COLUMN IF EXISTS energy_source;

DROP TABLE IF EXISTS organization.energy_source;
