--------------UP
-- Quiet hours could not express "mute all day".
--
-- The window is [start, end) in whole hours, and end was capped at 23, so the
-- widest window an operator could set was 0..23 — which leaves 23:00-00:00
-- live. Setting start = end does not help: fn_endpoint_in_quiet_hours reads
-- that as "no window", which is the right reading, because 0/0 is also what an
-- untouched form sends.
--
-- Widening end to 24 makes 0..24 the all-day window with no change to the
-- function: `hour >= 0 AND hour < 24` is already always true. Start stays
-- 0..23 — an all-day window starts somewhere real.
ALTER TABLE notifications.channels
    DROP CONSTRAINT IF EXISTS channels_quiet_hours_end_valid;

ALTER TABLE notifications.channels
    ADD CONSTRAINT channels_quiet_hours_end_valid
        CHECK (quiet_hours_end IS NULL
               OR (quiet_hours_end >= 0 AND quiet_hours_end <= 24));

--------------DOWN
-- Only reversible for rows inside the old bound; an all-day window has to go
-- back to 23:00 before the tighter constraint can be re-applied.
UPDATE notifications.channels
   SET quiet_hours_end = 23
 WHERE quiet_hours_end = 24;

ALTER TABLE notifications.channels
    DROP CONSTRAINT IF EXISTS channels_quiet_hours_end_valid;

ALTER TABLE notifications.channels
    ADD CONSTRAINT channels_quiet_hours_end_valid
        CHECK (quiet_hours_end IS NULL
               OR (quiet_hours_end >= 0 AND quiet_hours_end <= 23));
