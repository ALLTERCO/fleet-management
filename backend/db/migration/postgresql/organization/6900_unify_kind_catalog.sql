--------------UP
-- Merge group_kind (built-in catalog) and custom_kinds (per-org) into one
-- `organization.kind` table. organization_id NULL = built-in, else the owner
-- org. Both devices and groups foreign-key to it, so a kind is valid for either
-- and there is no second table to keep in sync. The built-in rows are still
-- authored in groupKindCatalog.ts and re-seeded on every boot.

BEGIN;

CREATE TABLE organization.kind (
    id              TEXT PRIMARY KEY,
    organization_id VARCHAR(120)
        REFERENCES organization.profile(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL,
    icon            TEXT,
    applies_to      TEXT NOT NULL DEFAULT 'group'
        CHECK (applies_to IN ('device', 'group', 'both')),
    metadata_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics         JSONB,
    sort_order      INTEGER NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

-- One custom slug per org; built-ins (org NULL) are unique by their bare id.
CREATE UNIQUE INDEX IF NOT EXISTS kind_org_slug_unique
    ON organization.kind (organization_id, slug)
    WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kind_category_sort
    ON organization.kind (category, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_kind_org
    ON organization.kind (organization_id)
    WHERE organization_id IS NOT NULL;

-- Built-ins: copy existing group_kind rows so the groups FK still validates.
-- applies_to is corrected to the catalog value by the boot seeder right after.
INSERT INTO organization.kind
    (id, organization_id, slug, display_name, description,
     category, icon, metadata_schema, sort_order)
SELECT id, NULL, id, display_name, description,
       category, icon, metadata_schema, sort_order
FROM organization.group_kind;

-- Custom kinds: carry owner, applies_to, schema + metrics across unchanged.
INSERT INTO organization.kind
    (id, organization_id, slug, display_name, description, category, icon,
     applies_to, metadata_schema, metrics, created_at, updated_at)
SELECT id, organization_id, slug, name, NULL, category, icon,
       applies_to, metadata, metrics, created_at, updated_at
FROM organization.custom_kinds;

-- Repoint the groups FK from group_kind to kind.
ALTER TABLE organization.groups DROP CONSTRAINT IF EXISTS groups_kind_fk;
ALTER TABLE organization.groups
    ADD CONSTRAINT groups_kind_fk
    FOREIGN KEY (kind) REFERENCES organization.kind(id);

-- Expand before contract: the 6830 backfill writes these built-in ids into
-- device.list.catalog_kind from the boot catalog, but group_kind may not yet
-- hold them at migration time. Seed them here so the null-sweep below never
-- wipes a backfilled classification; the boot seeder corrects every column.
INSERT INTO organization.kind
    (id, organization_id, slug, display_name, category, applies_to)
VALUES
    ('main_meter', NULL, 'main_meter', 'Main Meter', 'electrical', 'both'),
    ('submeter', NULL, 'submeter', 'Submeter', 'electrical', 'both'),
    ('solar_array', NULL, 'solar_array', 'Solar Array', 'solar', 'both'),
    ('battery_bank', NULL, 'battery_bank', 'Battery Bank',
     'energy_storage', 'both'),
    ('ev_charging_station', NULL, 'ev_charging_station',
     'EV Charging Station', 'ev', 'both'),
    ('hvac_zone', NULL, 'hvac_zone', 'HVAC Zone', 'building', 'both'),
    ('lighting_zone', NULL, 'lighting_zone', 'Lighting Zone',
     'building', 'both'),
    ('tenant', NULL, 'tenant', 'Tenant', 'property', 'both'),
    ('distribution_transformer', NULL, 'distribution_transformer',
     'Distribution Transformer', 'electrical', 'both')
ON CONFLICT (id) DO NOTHING;

-- Give devices the same integrity. Null out any dangling catalog_kind first
-- (catalog_kind was free text until now) so the new FK can validate.
UPDATE device.list SET catalog_kind = NULL
WHERE catalog_kind IS NOT NULL
  AND catalog_kind NOT IN (SELECT id FROM organization.kind);
ALTER TABLE device.list
    ADD CONSTRAINT device_catalog_kind_fk
    FOREIGN KEY (catalog_kind) REFERENCES organization.kind(id);

-- LINT-IGNORE: additive-only — deliberate catalog unification migration.
DROP TABLE organization.group_kind;
-- LINT-IGNORE: additive-only — deliberate catalog unification migration.
DROP TABLE organization.custom_kinds;

COMMIT;

--------------DOWN
-- Split the unified table back into the two originals, by owner.
BEGIN;

CREATE TABLE organization.group_kind (
    id              TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL,
    icon            TEXT,
    metadata_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order      INTEGER NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_group_kind_category_sort
    ON organization.group_kind (category, sort_order, id);

CREATE TABLE organization.custom_kinds (
    id              TEXT PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL,
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    icon            TEXT,
    applies_to      TEXT NOT NULL
        CHECK (applies_to IN ('device', 'group', 'both')),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    UNIQUE (organization_id, slug),
    FOREIGN KEY (organization_id)
        REFERENCES organization.profile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_custom_kinds_org
    ON organization.custom_kinds (organization_id);

INSERT INTO organization.group_kind
    (id, display_name, description, category, icon,
     metadata_schema, sort_order, created_at, updated_at)
SELECT id, display_name, description, category, icon,
       metadata_schema, sort_order, created_at, updated_at
FROM organization.kind WHERE organization_id IS NULL;

INSERT INTO organization.custom_kinds
    (id, organization_id, slug, name, category, icon,
     applies_to, metadata, metrics, created_at, updated_at)
SELECT id, organization_id, slug, display_name, category, icon,
       applies_to, metadata_schema, metrics, created_at, updated_at
FROM organization.kind WHERE organization_id IS NOT NULL;

ALTER TABLE device.list DROP CONSTRAINT IF EXISTS device_catalog_kind_fk;

-- The old schema cannot hold a custom kind on a group (its FK targets the
-- built-in catalog only). Reset any such group to 'manual' so the rollback
-- never fails; the custom classification is dropped with the new capability.
UPDATE organization.groups SET kind = 'manual'
WHERE kind IN (
    SELECT id FROM organization.kind WHERE organization_id IS NOT NULL
);

ALTER TABLE organization.groups DROP CONSTRAINT IF EXISTS groups_kind_fk;
ALTER TABLE organization.groups
    ADD CONSTRAINT groups_kind_fk
    FOREIGN KEY (kind) REFERENCES organization.group_kind(id);

DROP TABLE organization.kind;

COMMIT;
