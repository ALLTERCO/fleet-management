--------------UP
-- Tag color now accepts a palette token (e.g. "teal") or hex.
ALTER TABLE organization.tags ALTER COLUMN color TYPE VARCHAR(64);
ALTER TABLE organization.tags
    DROP CONSTRAINT IF EXISTS tags_color_pattern;
ALTER TABLE organization.tags
    ADD CONSTRAINT tags_color_pattern
    CHECK (color IS NULL OR color ~ '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_-]{0,63})$');
--------------DOWN
ALTER TABLE organization.tags
    DROP CONSTRAINT IF EXISTS tags_color_pattern;
ALTER TABLE organization.tags
    ADD CONSTRAINT tags_color_pattern
    CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');
