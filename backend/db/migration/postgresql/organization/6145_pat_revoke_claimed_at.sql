--------------UP
-- Track when a pat_revoke_schedule row was claimed so the worker can
-- reclaim stranded in_progress rows after a crash mid-revoke.

SET search_path TO organization;

ALTER TABLE pat_revoke_schedule
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

--------------DOWN
SET search_path TO organization;

ALTER TABLE pat_revoke_schedule
    DROP COLUMN IF EXISTS claimed_at;
