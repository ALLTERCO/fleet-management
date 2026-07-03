--------------UP
-- Case-insensitive sibling-name uniqueness ("Office" / "OFFICE" clash).
DROP INDEX IF EXISTS organization.locations_sibling_name_with_parent;
DROP INDEX IF EXISTS organization.locations_sibling_name_root;

CREATE UNIQUE INDEX locations_sibling_name_with_parent
    ON organization.locations (organization_id, parent_location_id, LOWER(name))
    WHERE parent_location_id IS NOT NULL;
CREATE UNIQUE INDEX locations_sibling_name_root
    ON organization.locations (organization_id, LOWER(name))
    WHERE parent_location_id IS NULL;
--------------DOWN
DROP INDEX IF EXISTS organization.locations_sibling_name_with_parent;
DROP INDEX IF EXISTS organization.locations_sibling_name_root;

CREATE UNIQUE INDEX locations_sibling_name_with_parent
    ON organization.locations (organization_id, parent_location_id, name)
    WHERE parent_location_id IS NOT NULL;
CREATE UNIQUE INDEX locations_sibling_name_root
    ON organization.locations (organization_id, name)
    WHERE parent_location_id IS NULL;
