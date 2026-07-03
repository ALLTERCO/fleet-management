--------------UP
-- Grandfather marker: every row that exists today is treated as "legacy".
-- Legacy groups accept name/metadata/member edits but reject parent changes;
-- new groups (is_legacy=FALSE) follow the v2 hierarchy rules.
ALTER TABLE organization.groups
    ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE organization.groups SET is_legacy = TRUE WHERE is_legacy = FALSE;
--------------DOWN
ALTER TABLE organization.groups DROP COLUMN IF EXISTS is_legacy;
