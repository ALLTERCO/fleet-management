--------------UP
-- Optimistic concurrency for groups. Same shape as virtual_device.
-- Existing rows start at 1; fn_group_update bumps on every write.
ALTER TABLE organization.groups
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

--------------DOWN
ALTER TABLE organization.groups
    DROP COLUMN IF EXISTS revision;
