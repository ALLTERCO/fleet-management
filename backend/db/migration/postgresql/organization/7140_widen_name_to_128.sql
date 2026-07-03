--------------UP
-- Widen entity name columns to match the API NAME_SCHEMA (128).
ALTER TABLE organization.groups ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE organization.tags ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE organization.locations ALTER COLUMN name TYPE VARCHAR(128);
--------------DOWN
ALTER TABLE organization.groups ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE organization.tags ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE organization.locations ALTER COLUMN name TYPE VARCHAR(120);
