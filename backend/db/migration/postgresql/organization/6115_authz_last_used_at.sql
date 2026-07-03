--------------UP
-- Track when an Assignment last contributed to a permission decision.
-- Resolver writes on cache miss only (avoids hammering the table on every
-- check). Surfaced in the admin UI to suggest revoke for unused grants.

ALTER TABLE organization.assignments
    ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS assignments_last_used_at_idx
    ON organization.assignments (last_used_at)
    WHERE last_used_at IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS organization.assignments_last_used_at_idx;
ALTER TABLE organization.assignments DROP COLUMN IF EXISTS last_used_at;
