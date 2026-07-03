--------------UP
-- Per-org custom kinds layered on top of the vendor catalog
-- (groupKindCatalog.ts). id is namespaced 'org_<uuid>:<slug>' so it never
-- collides with vendor bare-slug ids. organization_id matches the type other
-- org tables use (VARCHAR(120) -> organization.profile).
CREATE TABLE IF NOT EXISTS organization.custom_kinds (
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

--------------DOWN
DROP TABLE IF EXISTS organization.custom_kinds;
