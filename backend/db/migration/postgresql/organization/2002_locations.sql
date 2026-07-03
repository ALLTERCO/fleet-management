--------------UP
-- Physical scope. One tree per organization.
CREATE TABLE organization.locations (
    id                  SERIAL       PRIMARY KEY,
    organization_id     VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name                VARCHAR(120) NOT NULL,
    kind                VARCHAR(32)  NOT NULL,
    parent_location_id  INTEGER      REFERENCES organization.locations(id) ON DELETE RESTRICT,
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    timezone            VARCHAR(120),
    address             JSONB,
    location_code       VARCHAR(64),
    geo                 JSONB,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    CONSTRAINT locations_kind_valid CHECK (kind IN (
        'continent','country','region','county','city','neighborhood',
        'campus','site','building','office','floor','area','room','zone'
    ))
);

-- Two partial indexes — NULL parent escapes a plain UNIQUE in SQL.
CREATE UNIQUE INDEX locations_sibling_name_with_parent
    ON organization.locations (organization_id, parent_location_id, name)
    WHERE parent_location_id IS NOT NULL;
CREATE UNIQUE INDEX locations_sibling_name_root
    ON organization.locations (organization_id, name)
    WHERE parent_location_id IS NULL;

CREATE UNIQUE INDEX locations_code_unique
    ON organization.locations (organization_id, location_code)
    WHERE location_code IS NOT NULL;

CREATE INDEX locations_parent_idx
    ON organization.locations (parent_location_id);

--------------DOWN
DROP TABLE organization.locations;
