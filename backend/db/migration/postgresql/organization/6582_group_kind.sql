--------------UP
-- group_kind catalog table. Source of truth for the entries is the TS
-- module backend/src/config/groupKindCatalog.ts; the boot seeder UPSERTs
-- the catalog on every start. This migration only creates the empty
-- shell and a single bootstrap row so the FK on organization.groups
-- has a valid default for pre-existing rows.

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

-- Bootstrap row required for the FK below to validate against existing
-- group rows whose default kind is 'manual'. The seeder will overwrite
-- the row's display_name / description / icon at boot if they drift.
INSERT INTO organization.group_kind
    (id, display_name, description, category, icon, sort_order)
VALUES
    ('manual', 'Custom Group',
     'A generic folder — pick this when no other kind fits.',
     'general', 'fa-folder', 0);

ALTER TABLE organization.groups
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE organization.groups
    ADD CONSTRAINT groups_kind_fk
    FOREIGN KEY (kind) REFERENCES organization.group_kind(id);

CREATE INDEX IF NOT EXISTS idx_groups_by_kind
    ON organization.groups (organization_id, kind);

COMMIT;

--------------DOWN
BEGIN;
DROP INDEX IF EXISTS organization.idx_groups_by_kind;
ALTER TABLE organization.groups
    DROP CONSTRAINT IF EXISTS groups_kind_fk;
ALTER TABLE organization.groups
    DROP COLUMN IF EXISTS kind;
DROP TABLE IF EXISTS organization.group_kind;
COMMIT;
